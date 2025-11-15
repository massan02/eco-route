/**
 * RouteCalculator Service
 * Calculates routes using AWS Location Service
 */

import { 
  LocationClient, 
  CalculateRouteCommand,
  CalculateRouteCommandInput,
  CalculateRouteCommandOutput 
} from '@aws-sdk/client-location';
import { 
  Location, 
  LocationType, 
  ModeType, 
  TransportLeg 
} from '../lib/shared-types';

interface RouteCalculatorConfig {
  calculatorName: string;
  region: string;
}

interface RouteResult {
  distanceKm: number;
  timeHours: number;
}

interface ShipLinkInfo {
  from: Location;
  to: Location;
  distanceKm: number;
  timeHours: number;
}

interface RouteOptions {
  retries?: number;
  includeAlternatives?: boolean;
  retryCount?: number; // Internal use
}

export class RouteCalculator {
  private locationClient: LocationClient;
  private calculatorName: string;
  private routeCache: Map<string, RouteResult> = new Map();
  private tokenBucket = {
    tokens: 5,
    maxTokens: 5,
    refillRate: 5, // tokens per second
    lastRefill: Date.now()
  };

  constructor(config: RouteCalculatorConfig) {
    this.calculatorName = config.calculatorName;
    this.locationClient = new LocationClient({ region: config.region });
  }

  /**
   * Calculate truck route between two locations
   */
  async calculateTruckRoute(origin: Location, destination: Location, options?: RouteOptions): Promise<RouteResult> {
    // Handle both old and new API signatures
    const opts: RouteOptions = typeof options === 'number' 
      ? { retryCount: options } 
      : (options || {});
    
    const maxRetries = opts.retries || 3;
    const currentRetry = opts.retryCount || 0;

    // Validate coordinates
    if (!this.isValidCoordinate(origin.lat, origin.lon) || 
        !this.isValidCoordinate(destination.lat, destination.lon)) {
      throw new Error('Invalid coordinates');
    }

    // Check cache first (unless includeAlternatives is set)
    const cacheKey = `${origin.id}-${destination.id}`;
    if (!opts.includeAlternatives && this.routeCache.has(cacheKey)) {
      return this.routeCache.get(cacheKey)!;
    }

    // Apply throttling
    return this.throttleRequest(async () => {
      const input: CalculateRouteCommandInput = {
        CalculatorName: this.calculatorName,
        DeparturePosition: [origin.lon, origin.lat],
        DestinationPosition: [destination.lon, destination.lat],
        TravelMode: 'Truck',
        DistanceUnit: 'Kilometers',
        IncludeLegGeometry: false
      };

      try {
        const command = new CalculateRouteCommand(input);
        const response: CalculateRouteCommandOutput = await this.locationClient.send(command);

        if (!response || !response.Summary) {
          throw new Error('Invalid response from AWS Location Service');
        }

        const result: RouteResult = {
          distanceKm: response.Summary.Distance || 0,
          timeHours: (response.Summary.DurationSeconds || 0) / 3600
        };

        // Cache the result
        if (!opts.includeAlternatives) {
          this.routeCache.set(cacheKey, result);
        }

        return result;
      } catch (error: any) {
        // Retry logic for timeout errors
        if (error.message === 'Timeout' && currentRetry < maxRetries - 1) {
          return this.calculateTruckRoute(origin, destination, {
            ...opts,
            retryCount: currentRetry + 1
          });
        }
        
        if (error.name === 'ResourceNotFoundException') {
          throw new Error(`Route calculator ${this.calculatorName} not found`);
        }
        if (error.name === 'ValidationException') {
          throw new Error('Invalid coordinates provided');
        }
        throw error;
      }
    });
  }

  /**
   * Validate coordinates
   */
  private isValidCoordinate(lat: number, lon: number): boolean {
    return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }

  /**
   * Plan multi-modal route (truck + ship + truck)
   */
  async planMultiModalRoute(
    origin: Location,
    destination: Location,
    originPort: Location,
    destinationPort: Location,
    shipLink: ShipLinkInfo
  ): Promise<TransportLeg[]> {
    const legs: TransportLeg[] = [];

    // First leg: City to Port (truck)
    const firstLeg = await this.calculateTruckRoute(origin, originPort);
    legs.push({
      from: origin.name,
      to: originPort.name,
      mode: ModeType.TRUCK,
      distanceKm: firstLeg.distanceKm,
      timeHours: firstLeg.timeHours
    });

    // Second leg: Port to Port (ship)
    legs.push({
      from: originPort.name,
      to: destinationPort.name,
      mode: ModeType.SHIP,
      distanceKm: shipLink.distanceKm,
      timeHours: shipLink.timeHours
    });

    // Third leg: Port to City (truck)
    const lastLeg = await this.calculateTruckRoute(destinationPort, destination);
    legs.push({
      from: destinationPort.name,
      to: destination.name,
      mode: ModeType.TRUCK,
      distanceKm: lastLeg.distanceKm,
      timeHours: lastLeg.timeHours
    });

    return legs;
  }

  /**
   * Find nearest port to a given location
   */
  findNearestPort(location: Location, allLocations: Location[]): Location | undefined {
    const ports = allLocations.filter(loc => loc.type === LocationType.PORT);
    
    if (ports.length === 0) {
      return undefined;
    }

    let nearestPort: Location | undefined;
    let minDistance = Infinity;

    for (const port of ports) {
      const distance = this.calculateDistance(location, port);
      if (distance < minDistance) {
        minDistance = distance;
        nearestPort = port;
      }
    }

    return nearestPort;
  }

  /**
   * Calculate straight-line distance between two locations (Haversine formula)
   */
  private calculateDistance(loc1: Location, loc2: Location): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(loc2.lat - loc1.lat);
    const dLon = this.toRad(loc2.lon - loc1.lon);
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(loc1.lat)) * Math.cos(this.toRad(loc2.lat)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(degree: number): number {
    return degree * (Math.PI / 180);
  }

  /**
   * Clear route cache
   */
  clearCache(): void {
    this.routeCache.clear();
  }

  /**
   * Calculate route with waypoints
   */
  async calculateRouteWithWaypoints(
    origin: Location,
    destination: Location,
    waypoints: Location[]
  ): Promise<any> {
    // For MVP, we'll calculate segments and sum them
    let totalDistance = 0;
    let totalTime = 0;
    const legs: any[] = [];
    
    const points = [origin, ...waypoints, destination];
    
    for (let i = 0; i < points.length - 1; i++) {
      const segment = await this.calculateTruckRoute(points[i], points[i + 1]);
      totalDistance += segment.distanceKm;
      totalTime += segment.timeHours;
      legs.push({
        from: points[i].name,
        to: points[i + 1].name,
        distanceKm: segment.distanceKm,
        timeHours: segment.timeHours
      });
    }
    
    return {
      totalDistanceKm: totalDistance,
      totalTimeHours: totalTime,
      legs
    };
  }

  /**
   * Calculate all routes in batch
   */
  async calculateAllRoutes(
    input: Location[] | Array<{ origin: Location; destination: Location }>
  ): Promise<RouteResult[]> {
    let pairs: Array<{ origin: Location; destination: Location }>;
    
    // Handle both input formats
    if (input.length > 0 && 'origin' in input[0]) {
      // Already in pairs format
      pairs = input as Array<{ origin: Location; destination: Location }>;
    } else {
      // Convert cities array to all possible pairs
      const cities = input as Location[];
      pairs = [];
      for (let i = 0; i < cities.length; i++) {
        for (let j = i + 1; j < cities.length; j++) {
          pairs.push({ origin: cities[i], destination: cities[j] });
        }
      }
    }
    
    const results: RouteResult[] = [];

    // Process all pairs with individual throttling
    for (const pair of pairs) {
      const result = await this.calculateTruckRoute(pair.origin, pair.destination);
      results.push(result);
    }

    return results;
  }

  /**
   * Acquire a token from the token bucket for rate limiting
   */
  private async acquireToken(): Promise<void> {
    const now = Date.now();
    const timePassed = (now - this.tokenBucket.lastRefill) / 1000;
    const tokensToAdd = Math.min(
      timePassed * this.tokenBucket.refillRate,
      this.tokenBucket.maxTokens - this.tokenBucket.tokens
    );

    this.tokenBucket.tokens += tokensToAdd;
    this.tokenBucket.lastRefill = now;

    if (this.tokenBucket.tokens < 1) {
      const waitTime = (1 - this.tokenBucket.tokens) / this.tokenBucket.refillRate * 1000;
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.acquireToken();
    }

    this.tokenBucket.tokens -= 1;
  }

  /**
   * Throttle requests to respect rate limits using Token Bucket algorithm
   */
  private async throttleRequest<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquireToken();
    return fn();
  }
}