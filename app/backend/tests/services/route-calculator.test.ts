/**
 * Service Test: RouteCalculator
 * Tests the route calculation service with AWS Location Service mocking
 * 
 * Test Scenarios:
 * - Distance calculation between cities
 * - Multi-modal route planning
 * - Port connection logic
 * - Error handling for invalid locations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { LocationClient, CalculateRouteCommand } from '@aws-sdk/client-location';
import { RouteCalculator } from '../../src/services/RouteCalculator';
import { Location, LocationType, ModeType } from '../../src/lib/shared-types';
import { TEST_CONFIG } from '../setup/test-config';

const locationMock = mockClient(LocationClient);

describe('RouteCalculator Service', () => {
  let calculator: RouteCalculator;

  beforeEach(() => {
    locationMock.reset();
    calculator = new RouteCalculator({
      calculatorName: TEST_CONFIG.aws.locationCalculatorName,
      region: TEST_CONFIG.aws.region
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Distance Calculation', () => {
    it('should calculate direct truck distance between two cities', async () => {
      // Setup mock response for Tokyo to Osaka
      locationMock.on(CalculateRouteCommand).resolves({
        Summary: {
          Distance: 520,
          DurationSeconds: 25920, // 7.2 hours
          RouteBBox: [],
          DataSource: 'Here',
          DistanceUnit: 'Kilometers'
        },
        Legs: [{
          Distance: 520,
          DurationSeconds: 25920,
          StartPosition: [139.6917, 35.6895], // Tokyo
          EndPosition: [135.5023, 34.6937], // Osaka
          Steps: []
        }]
      });

      const origin: Location = {
        id: 'tokyo',
        name: 'Tokyo',
        lat: 35.6895,
        lon: 139.6917,
        type: LocationType.CITY
      };

      const destination: Location = {
        id: 'osaka',
        name: 'Osaka',
        lat: 34.6937,
        lon: 135.5023,
        type: LocationType.CITY
      };

      const result = await calculator.calculateTruckRoute(origin, destination);

      expect(result).toBeDefined();
      expect(result.distanceKm).toBe(520);
      expect(result.timeHours).toBeCloseTo(7.2, 1);
    });

    it('should handle short distances correctly', async () => {
      locationMock.on(CalculateRouteCommand).resolves({
        Summary: {
          Distance: 30,
          DurationSeconds: 2700, // 0.75 hours
          RouteBBox: [],
          DataSource: 'Here',
          DistanceUnit: 'Kilometers'
        }
      });

      const origin: Location = {
        id: 'tokyo',
        name: 'Tokyo',
        lat: 35.6895,
        lon: 139.6917,
        type: LocationType.CITY
      };

      const destination: Location = {
        id: 'yokohama',
        name: 'Yokohama',
        lat: 35.4437,
        lon: 139.6380,
        type: LocationType.CITY
      };

      const result = await calculator.calculateTruckRoute(origin, destination);

      expect(result.distanceKm).toBe(30);
      expect(result.timeHours).toBeCloseTo(0.75, 2);
    });

    it('should cache repeated route calculations', async () => {
      locationMock.on(CalculateRouteCommand).resolves({
        Summary: {
          Distance: 520,
          DurationSeconds: 25920,
          RouteBBox: [],
          DataSource: 'Here',
          DistanceUnit: 'Kilometers'
        }
      });

      const origin: Location = {
        id: 'tokyo',
        name: 'Tokyo',
        lat: 35.6895,
        lon: 139.6917,
        type: LocationType.CITY
      };

      const destination: Location = {
        id: 'osaka',
        name: 'Osaka',
        lat: 34.6937,
        lon: 135.5023,
        type: LocationType.CITY
      };

      // First call - should hit AWS
      await calculator.calculateTruckRoute(origin, destination);
      
      // Second call - should use cache
      await calculator.calculateTruckRoute(origin, destination);

      // Verify AWS was only called once
      const calls = locationMock.commandCalls(CalculateRouteCommand);
      expect(calls.length).toBe(1);
    });
  });

  describe('Multi-Modal Route Planning', () => {
    it('should plan truck+ship route with port connections', async () => {
      // Mock truck segments
      locationMock.on(CalculateRouteCommand).resolves({
        Summary: {
          Distance: 50,
          DurationSeconds: 3600, // 1 hour
          RouteBBox: [],
          DataSource: 'Here',
          DistanceUnit: 'Kilometers'
        }
      });

      const tokyoPort: Location = {
        id: 'tokyo-port',
        name: 'Tokyo Port',
        lat: 35.6329,
        lon: 139.7753,
        type: LocationType.PORT
      };

      const osakaPort: Location = {
        id: 'osaka-port',
        name: 'Osaka Port',
        lat: 34.6503,
        lon: 135.4278,
        type: LocationType.PORT
      };

      const shipLink = {
        from: tokyoPort,
        to: osakaPort,
        distanceKm: 400,
        timeHours: 12
      };

      const legs = await calculator.planMultiModalRoute(
        { id: 'tokyo', name: 'Tokyo', lat: 35.6895, lon: 139.6917, type: LocationType.CITY },
        { id: 'osaka', name: 'Osaka', lat: 34.6937, lon: 135.5023, type: LocationType.CITY },
        tokyoPort,
        osakaPort,
        shipLink
      );

      expect(legs).toHaveLength(3);
      
      // First leg: City to Port (truck)
      expect(legs[0].mode).toBe(ModeType.TRUCK);
      expect(legs[0].from).toBe('Tokyo');
      expect(legs[0].to).toBe('Tokyo Port');
      
      // Second leg: Port to Port (ship)
      expect(legs[1].mode).toBe(ModeType.SHIP);
      expect(legs[1].from).toBe('Tokyo Port');
      expect(legs[1].to).toBe('Osaka Port');
      expect(legs[1].distanceKm).toBe(400);
      expect(legs[1].timeHours).toBe(12);
      
      // Third leg: Port to City (truck)
      expect(legs[2].mode).toBe(ModeType.TRUCK);
      expect(legs[2].from).toBe('Osaka Port');
      expect(legs[2].to).toBe('Osaka');
    });

    it('should find nearest ports for origin and destination', async () => {
      const locations: Location[] = [
        { id: 'tokyo', name: 'Tokyo', lat: 35.6895, lon: 139.6917, type: LocationType.CITY },
        { id: 'tokyo-port', name: 'Tokyo Port', lat: 35.6329, lon: 139.7753, type: LocationType.PORT },
        { id: 'yokohama-port', name: 'Yokohama Port', lat: 35.4437, lon: 139.6380, type: LocationType.PORT },
        { id: 'osaka', name: 'Osaka', lat: 34.6937, lon: 135.5023, type: LocationType.CITY },
        { id: 'osaka-port', name: 'Osaka Port', lat: 34.6503, lon: 135.4278, type: LocationType.PORT },
        { id: 'kobe-port', name: 'Kobe Port', lat: 34.6901, lon: 135.1956, type: LocationType.PORT }
      ];

      const tokyo = locations[0];
      const osaka = locations[3];

      const nearestToTokyo = calculator.findNearestPort(tokyo, locations);
      const nearestToOsaka = calculator.findNearestPort(osaka, locations);

      expect(nearestToTokyo?.name).toBe('Tokyo Port');
      expect(nearestToOsaka?.name).toBe('Osaka Port');
    });

    it('should handle routes where no ship connection exists', async () => {
      const locations: Location[] = [
        { id: 'nagano', name: 'Nagano', lat: 36.6485, lon: 138.1811, type: LocationType.CITY },
        { id: 'gunma', name: 'Gunma', lat: 36.3909, lon: 139.0609, type: LocationType.CITY }
      ];

      // No ports available for inland cities
      const nearestPort = calculator.findNearestPort(locations[0], locations);
      
      expect(nearestPort).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle AWS Location Service errors gracefully', async () => {
      locationMock.on(CalculateRouteCommand).rejects(new Error('AWS Location Service unavailable'));

      const origin: Location = {
        id: 'tokyo',
        name: 'Tokyo',
        lat: 35.6895,
        lon: 139.6917,
        type: LocationType.CITY
      };

      const destination: Location = {
        id: 'osaka',
        name: 'Osaka',
        lat: 34.6937,
        lon: 135.5023,
        type: LocationType.CITY
      };

      await expect(calculator.calculateTruckRoute(origin, destination))
        .rejects.toThrow('AWS Location Service unavailable');
    });

    it('should validate coordinates before calling AWS', async () => {
      const invalidOrigin: Location = {
        id: 'invalid',
        name: 'Invalid',
        lat: 200, // Invalid latitude
        lon: 139.6917,
        type: LocationType.CITY
      };

      const destination: Location = {
        id: 'osaka',
        name: 'Osaka',
        lat: 34.6937,
        lon: 135.5023,
        type: LocationType.CITY
      };

      await expect(calculator.calculateTruckRoute(invalidOrigin, destination))
        .rejects.toThrow('Invalid coordinates');
    });

    it('should handle timeout errors with retry logic', async () => {
      let callCount = 0;
      locationMock.on(CalculateRouteCommand).callsFake(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.reject(new Error('Timeout'));
        }
        return Promise.resolve({
          Summary: {
            Distance: 520,
            DurationSeconds: 25920,
            RouteBBox: [],
            DataSource: 'Here',
            DistanceUnit: 'Kilometers'
          }
        });
      });

      const origin: Location = {
        id: 'tokyo',
        name: 'Tokyo',
        lat: 35.6895,
        lon: 139.6917,
        type: LocationType.CITY
      };

      const destination: Location = {
        id: 'osaka',
        name: 'Osaka',
        lat: 34.6937,
        lon: 135.5023,
        type: LocationType.CITY
      };

      const result = await calculator.calculateTruckRoute(origin, destination, { retries: 3 });
      
      expect(result.distanceKm).toBe(520);
      expect(callCount).toBe(3);
    });

    it('should handle missing response data', async () => {
      locationMock.on(CalculateRouteCommand).resolves({
        // Missing Summary field
        Legs: []
      });

      const origin: Location = {
        id: 'tokyo',
        name: 'Tokyo',
        lat: 35.6895,
        lon: 139.6917,
        type: LocationType.CITY
      };

      const destination: Location = {
        id: 'osaka',
        name: 'Osaka',
        lat: 34.6937,
        lon: 135.5023,
        type: LocationType.CITY
      };

      await expect(calculator.calculateTruckRoute(origin, destination))
        .rejects.toThrow('Invalid response from AWS Location Service');
    });
  });

  describe('Route Optimization', () => {
    it('should optimize route with waypoints', async () => {
      // TODO(#issue-1): Fix waypoint distance calculation logic
      // Currently returns 1100km instead of expected 550km
      // Mock for Tokyo -> Nagano leg
      locationMock.on(CalculateRouteCommand)
        .resolvesOnce({
          Summary: {
            Distance: 250,
            DurationSeconds: 12600, // 3.5 hours
            RouteBBox: [],
            DataSource: 'Here',
            DistanceUnit: 'Kilometers'
          }
        })
        // Mock for Nagano -> Osaka leg
        .resolvesOnce({
          Summary: {
            Distance: 300,
            DurationSeconds: 14400, // 4 hours
            RouteBBox: [],
            DataSource: 'Here',
            DistanceUnit: 'Kilometers'
          }
        });

      const origin: Location = {
        id: 'tokyo',
        name: 'Tokyo',
        lat: 35.6895,
        lon: 139.6917,
        type: LocationType.CITY
      };

      const waypoint: Location = {
        id: 'nagano',
        name: 'Nagano',
        lat: 36.2048,
        lon: 138.2529,
        type: LocationType.CITY
      };

      const destination: Location = {
        id: 'osaka',
        name: 'Osaka',
        lat: 34.6937,
        lon: 135.5023,
        type: LocationType.CITY
      };

      const result = await calculator.calculateRouteWithWaypoints(
        origin, 
        destination,
        [waypoint]
      );

      expect(result.totalDistanceKm).toBe(550);
      expect(result.totalTimeHours).toBeCloseTo(7.5, 1);
      expect(result.legs).toHaveLength(2);
    });

    it('should compare direct vs waypoint routes', async () => {
      // Direct route
      locationMock.on(CalculateRouteCommand)
        .resolvesOnce({
          Summary: { 
            Distance: 520, 
            DurationSeconds: 25920,
            RouteBBox: [],
            DataSource: 'Here',
            DistanceUnit: 'Kilometers'
          }
        })
        // Route with waypoint
        .resolvesOnce({
          Summary: { 
            Distance: 550, 
            DurationSeconds: 27000,
            RouteBBox: [],
            DataSource: 'Here',
            DistanceUnit: 'Kilometers'
          }
        });

      const origin: Location = {
        id: 'tokyo',
        name: 'Tokyo',
        lat: 35.6895,
        lon: 139.6917,
        type: LocationType.CITY
      };

      const destination: Location = {
        id: 'osaka',
        name: 'Osaka',
        lat: 34.6937,
        lon: 135.5023,
        type: LocationType.CITY
      };

      const direct = await calculator.calculateTruckRoute(origin, destination);
      await calculator.calculateTruckRoute(origin, destination, {
        includeAlternatives: true
      });

      expect(direct.distanceKm).toBeLessThan(550);
    });
  });

  describe('Performance', () => {
    it('should handle batch route calculations efficiently', async () => {
      locationMock.on(CalculateRouteCommand).resolves({
        Summary: {
          Distance: 100,
          DurationSeconds: 3600,
          RouteBBox: [],
          DataSource: 'Here',
          DistanceUnit: 'Kilometers'
        }
      });

      const cities: Location[] = [
        { id: 'tokyo', name: 'Tokyo', lat: 35.6895, lon: 139.6917, type: LocationType.CITY },
        { id: 'osaka', name: 'Osaka', lat: 34.6937, lon: 135.5023, type: LocationType.CITY },
        { id: 'nagoya', name: 'Nagoya', lat: 35.1815, lon: 136.9066, type: LocationType.CITY },
        { id: 'kyoto', name: 'Kyoto', lat: 35.0116, lon: 135.7681, type: LocationType.CITY }
      ];

      const startTime = Date.now();
      
      // Calculate all possible routes
      const routes = await calculator.calculateAllRoutes(cities);
      
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete within reasonable time
      expect(duration).toBeLessThan(TEST_CONFIG.validation.maxResponseTime);
      
      // Should return n*(n-1)/2 routes for n cities
      expect(routes.length).toBe(6); // 4 cities = 6 routes
    });

    it('should implement request throttling for AWS API limits', async () => {
      // TODO(#issue-1): Fine-tune request throttling timing
      // Currently completes in 202ms instead of expected 1000ms+
      let requestCount = 0;
      locationMock.on(CalculateRouteCommand).callsFake(() => {
        requestCount++;
        return Promise.resolve({
          Summary: { 
            Distance: 100, 
            DurationSeconds: 3600,
            RouteBBox: [],
            DataSource: 'Here',
            DistanceUnit: 'Kilometers'
          }
        });
      });

      const requests = Array(10).fill(null).map((_, i) => ({
        origin: { id: `city${i}`, name: `City ${i}`, lat: 35 + i * 0.1, lon: 139 + i * 0.1, type: LocationType.CITY },
        destination: { id: 'osaka', name: 'Osaka', lat: 34.6937, lon: 135.5023, type: LocationType.CITY }
      }));

      const startTime = Date.now();
      
      await Promise.all(
        requests.map(r => calculator.calculateTruckRoute(r.origin, r.destination))
      );
      
      const duration = Date.now() - startTime;

      // Should implement throttling (e.g., max 5 requests per second)
      expect(duration).toBeGreaterThanOrEqual(1000); // Should take at least 2 seconds for 10 requests
      expect(requestCount).toBe(10);
    });
  });
});