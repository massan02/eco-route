/**
 * ScoreOptimizer Service
 * Calculates weighted scores and recommendations for transport plans
 */

import {
  TransportPlan,
  PlanType,
  WeightFactors,
  ComparisonResult,
  RouteRationale,
} from '../lib/shared-types';

interface OptimizerConfig {
  normalizationMethod: 'min-max' | 'z-score';
  epsilon?: number;
}

interface NormalizedPlan extends TransportPlan {
  normalizedTime: number;
  normalizedCost: number;
  normalizedCo2: number;
}

interface ComparisonDetail {
  recommendation: PlanType;
  scores: Record<string, number>;
}

interface ComparisonMetadata {
  truckDistance?: number;
  calculationTimeMs?: number;
}

export class ScoreOptimizer {
  private normalizationMethod: 'min-max' | 'z-score';
  private epsilon: number;

  constructor(config: OptimizerConfig) {
    this.normalizationMethod = config.normalizationMethod;
    this.epsilon = config.epsilon || 0.001;
  }

  /**
   * Calculate weighted score for a single plan
   */
  calculateScore(plan: TransportPlan, weights: WeightFactors): number {
    // Validate negative values
    if (plan.timeH < 0 || plan.costJpy < 0 || plan.co2Kg < 0) {
      throw new Error('Invalid metric values');
    }

    // Normalize weights if they don't sum to 1
    const normalizedWeights = this.normalizeWeights(weights);

    // Simple weighted sum (not normalized between plans)
    return (
      normalizedWeights.time * plan.timeH +
      normalizedWeights.cost * (plan.costJpy / 1000) + // Scale down cost
      normalizedWeights.co2 * plan.co2Kg
    );
  }

  /**
   * Normalize weights to sum to 1
   */
  normalizeWeights(weights: WeightFactors): WeightFactors {
    const sum = weights.time + weights.cost + weights.co2;

    if (sum === 0) {
      return { time: 0.33, cost: 0.33, co2: 0.34 };
    }

    return {
      time: weights.time / sum,
      cost: weights.cost / sum,
      co2: weights.co2 / sum,
    };
  }

  /**
   * Compare multiple plans and recommend the best one
   */
  comparePlans(plans: TransportPlan[], weights: WeightFactors): ComparisonDetail {
    const normalizedWeights = this.normalizeWeights(weights);
    const normalizedPlans = this.normalizeMetrics(plans);

    const scores: Record<string, number> = {};
    let minScore = Infinity;
    let recommendation: PlanType = plans[0].plan;

    for (let i = 0; i < plans.length; i++) {
      const plan = plans[i];
      const normalized = normalizedPlans[i];

      // Calculate score using normalized values
      const score =
        normalizedWeights.time * normalized.normalizedTime +
        normalizedWeights.cost * normalized.normalizedCost +
        normalizedWeights.co2 * normalized.normalizedCo2;

      const planKey = plan.plan === PlanType.TRUCK ? 'truck' : 'truck+ship';
      scores[planKey] = score;

      if (score < minScore) {
        minScore = score;
        recommendation = plan.plan;
      }
    }

    return {
      recommendation,
      scores,
    };
  }

  /**
   * Normalize metrics across plans
   */
  normalizeMetrics(plans: TransportPlan[]): NormalizedPlan[] {
    if (this.normalizationMethod === 'min-max') {
      return this.minMaxNormalize(plans);
    } else {
      return this.zScoreNormalize(plans);
    }
  }

  /**
   * Min-Max normalization (0-1 range)
   */
  private minMaxNormalize(plans: TransportPlan[]): NormalizedPlan[] {
    if (plans.length === 0) return [];

    // Find min and max for each metric
    const times = plans.map((p) => p.timeH);
    const costs = plans.map((p) => p.costJpy);
    const co2s = plans.map((p) => p.co2Kg);

    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const minCost = Math.min(...costs);
    const maxCost = Math.max(...costs);
    const minCo2 = Math.min(...co2s);
    const maxCo2 = Math.max(...co2s);

    return plans.map((plan) => {
      const rangeTime = maxTime - minTime;
      const rangeCost = maxCost - minCost;
      const rangeCo2 = maxCo2 - minCo2;

      return {
        ...plan,
        normalizedTime: rangeTime > this.epsilon ? (plan.timeH - minTime) / rangeTime : 0.5,
        normalizedCost: rangeCost > this.epsilon ? (plan.costJpy - minCost) / rangeCost : 0.5,
        normalizedCo2: rangeCo2 > this.epsilon ? (plan.co2Kg - minCo2) / rangeCo2 : 0.5,
      };
    });
  }

  /**
   * Z-Score normalization (standard deviation based)
   */
  private zScoreNormalize(plans: TransportPlan[]): NormalizedPlan[] {
    if (plans.length === 0) return [];

    const times = plans.map((p) => p.timeH);
    const costs = plans.map((p) => p.costJpy);
    const co2s = plans.map((p) => p.co2Kg);

    const meanTime = this.mean(times);
    const meanCost = this.mean(costs);
    const meanCo2 = this.mean(co2s);

    const stdTime = this.standardDeviation(times, meanTime);
    const stdCost = this.standardDeviation(costs, meanCost);
    const stdCo2 = this.standardDeviation(co2s, meanCo2);

    return plans.map((plan) => {
      return {
        ...plan,
        normalizedTime: stdTime > this.epsilon ? (plan.timeH - meanTime) / stdTime : 0,
        normalizedCost: stdCost > this.epsilon ? (plan.costJpy - meanCost) / stdCost : 0,
        normalizedCo2: stdCo2 > this.epsilon ? (plan.co2Kg - meanCo2) / stdCo2 : 0,
      };
    });
  }

  /**
   * Calculate mean of array
   */
  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  /**
   * Calculate standard deviation
   */
  private standardDeviation(values: number[], mean: number): number {
    if (values.length === 0) return 0;
    const squaredDiffs = values.map((val) => Math.pow(val - mean, 2));
    const avgSquaredDiff = this.mean(squaredDiffs);
    return Math.sqrt(avgSquaredDiff);
  }

  /**
   * Generate complete comparison result for API response
   */
  generateComparisonResult(
    plans: TransportPlan[],
    weights: WeightFactors,
    metadata: ComparisonMetadata
  ): ComparisonResult {
    const comparison = this.comparePlans(plans, weights);

    // Build rationale
    const rationale: RouteRationale = {};

    const truckPlan = plans.find((p) => p.plan === PlanType.TRUCK);
    if (truckPlan && metadata.truckDistance) {
      rationale.truck = {
        distanceKm: metadata.truckDistance,
      };
    }

    const shipPlan = plans.find((p) => p.plan === PlanType.TRUCK_SHIP);
    if (shipPlan && shipPlan.legs) {
      rationale['truck+ship'] = {
        legs: shipPlan.legs,
      };
    }

    return {
      candidates: plans,
      recommendation: comparison.recommendation,
      rationale,
      metadata: {
        calculationTimeMs: metadata.calculationTimeMs || 0,
        dataVersion: '1.0.0',
      },
    };
  }

  /**
   * Get detailed score breakdown for each plan
   */
  getScoreBreakdown(plans: TransportPlan[], weights: WeightFactors): Record<string, any> {
    const normalizedWeights = this.normalizeWeights(weights);
    const normalizedPlans = this.normalizeMetrics(plans);
    const breakdown: Record<string, any> = {};

    for (let i = 0; i < plans.length; i++) {
      const plan = plans[i];
      const normalized = normalizedPlans[i];
      const planKey = plan.plan === PlanType.TRUCK ? 'truck' : 'truck+ship';

      breakdown[planKey] = {
        timeComponent: normalizedWeights.time * normalized.normalizedTime,
        costComponent: normalizedWeights.cost * normalized.normalizedCost,
        co2Component: normalizedWeights.co2 * normalized.normalizedCo2,
        totalScore:
          normalizedWeights.time * normalized.normalizedTime +
          normalizedWeights.cost * normalized.normalizedCost +
          normalizedWeights.co2 * normalized.normalizedCo2,
        rawMetrics: {
          time: plan.timeH,
          cost: plan.costJpy,
          co2: plan.co2Kg,
        },
        normalizedMetrics: {
          time: normalized.normalizedTime,
          cost: normalized.normalizedCost,
          co2: normalized.normalizedCo2,
        },
      };
    }

    return breakdown;
  }

  /**
   * Analyze sensitivity to weight changes
   */
  analyzeSensitivity(plans: TransportPlan[]): {
    timeThreshold: number | null;
    costThreshold: number | null;
    co2Threshold: number | null;
  } {
    const findThreshold = (dimension: 'time' | 'cost' | 'co2'): number | null => {
      let low = 0;
      let high = 1;
      const epsilon = 0.001;
      const maxIterations = 100;
      let iterations = 0;

      // Get baseline recommendation with very small weight for this dimension
      const baselineWeights = {
        time: dimension === 'time' ? epsilon : (1 - epsilon) / 2,
        cost: dimension === 'cost' ? epsilon : (1 - epsilon) / 2,
        co2: dimension === 'co2' ? epsilon : (1 - epsilon) / 2
      };
      const baselineResult = this.comparePlans(plans, baselineWeights);

      // Binary search for the threshold where recommendation changes
      while (high - low > epsilon && iterations < maxIterations) {
        const mid = (low + high) / 2;

        // Create weights with this dimension at mid, others balanced
        const testWeights = {
          time: dimension === 'time' ? mid : (1 - mid) / 2,
          cost: dimension === 'cost' ? mid : (1 - mid) / 2,
          co2: dimension === 'co2' ? mid : (1 - mid) / 2
        };

        const result = this.comparePlans(plans, testWeights);

        // If recommendation changed, we found the threshold region
        if (result.recommendation !== baselineResult.recommendation) {
          high = mid;
        } else {
          low = mid;
        }

        iterations++;
      }

      // Return the threshold, or null if no change point found
      return iterations < maxIterations ? (low + high) / 2 : null;
    };

    return {
      timeThreshold: findThreshold('time'),
      costThreshold: findThreshold('cost'),
      co2Threshold: findThreshold('co2')
    };
  }

  /**
   * Identify dominant factors in decision
   */
  identifyDominantFactors(plans: TransportPlan[]): Record<string, string[]> {
    const factors: Record<string, string[]> = {};

    for (const plan of plans) {
      const planKey = plan.plan === PlanType.TRUCK ? 'truck' : 'truck+ship';
      const dominantFactors: string[] = [];

      // Compare against other plans to find advantages
      for (const otherPlan of plans) {
        if (plan === otherPlan) continue;

        // Calculate relative advantages (>1 means this plan is better)
        const timeAdvantage = otherPlan.timeH / plan.timeH;
        const costAdvantage = otherPlan.costJpy / plan.costJpy;
        const co2Advantage = otherPlan.co2Kg / plan.co2Kg;

        // Consider 1.5x or better as dominant advantage
        if (timeAdvantage >= 1.5 && !dominantFactors.includes('time')) {
          dominantFactors.push('time');
        }
        if (costAdvantage >= 1.5 && !dominantFactors.includes('cost')) {
          dominantFactors.push('cost');
        }
        if (co2Advantage >= 1.5 && !dominantFactors.includes('co2')) {
          dominantFactors.push('co2');
        }
      }

      factors[planKey] = dominantFactors.length > 0 ? dominantFactors : ['balanced'];
    }

    return factors;
  }

  /**
   * Batch compare single plan set with multiple weight configurations
   */
  batchCompare(
    plans: TransportPlan[],
    weightSets: WeightFactors[]
  ): ComparisonDetail[] {
    const results: ComparisonDetail[] = [];

    // Compare plans with each weight configuration
    for (const weights of weightSets) {
      const comparison = this.comparePlans(plans, weights);
      results.push(comparison);
    }

    return results;
  }
}
