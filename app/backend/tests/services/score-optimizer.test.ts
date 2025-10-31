/**
 * Service Test: ScoreOptimizer
 * Tests the weighted scoring and optimization service
 * 
 * Test Scenarios:
 * - Score calculation with different weight configurations
 * - Normalization algorithms
 * - Recommendation logic
 * - Edge cases and error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ScoreOptimizer } from '../../src/services/ScoreOptimizer';
import { 
  TransportPlan, 
  PlanType, 
  WeightFactors
} from '../../src/lib/shared-types';
import { 
  assertApproximatelyEqual,
  assertNormalizedWeights
} from '../setup/assertions';

describe('ScoreOptimizer Service', () => {
  let optimizer: ScoreOptimizer;

  beforeEach(() => {
    optimizer = new ScoreOptimizer({
      normalizationMethod: 'min-max',
      epsilon: 0.001
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Score Calculation', () => {
    it('should calculate weighted score for a single plan', () => {
      const plan: TransportPlan = {
        plan: PlanType.TRUCK,
        timeH: 7.2,
        costJpy: 15600,
        co2Kg: 26
      };

      const weights: WeightFactors = {
        time: 0.7,
        cost: 0.2,
        co2: 0.1
      };

      const score = optimizer.calculateScore(plan, weights);

      expect(score).toBeGreaterThan(0);
      expect(typeof score).toBe('number');
    });

    it('should handle extreme weight configurations', () => {
      const plan: TransportPlan = {
        plan: PlanType.TRUCK,
        timeH: 7.2,
        costJpy: 15600,
        co2Kg: 26
      };

      // Pure time optimization
      const timeOnlyScore = optimizer.calculateScore(plan, { time: 1, cost: 0, co2: 0 });
      
      // Pure cost optimization
      const costOnlyScore = optimizer.calculateScore(plan, { time: 0, cost: 1, co2: 0 });
      
      // Pure CO2 optimization
      const co2OnlyScore = optimizer.calculateScore(plan, { time: 0, cost: 0, co2: 1 });

      // Scores should be different for different weight configurations
      expect(timeOnlyScore).not.toBe(costOnlyScore);
      expect(costOnlyScore).not.toBe(co2OnlyScore);
      expect(timeOnlyScore).not.toBe(co2OnlyScore);
    });

    it("should normalize weights if they don't sum to 1", () => {
      const plan: TransportPlan = {
        plan: PlanType.TRUCK,
        timeH: 7.2,
        costJpy: 15600,
        co2Kg: 26
      };

      const unnormalizedWeights: WeightFactors = {
        time: 3,
        cost: 2,
        co2: 1
      };

      const normalizedWeights = optimizer.normalizeWeights(unnormalizedWeights);
      
      assertNormalizedWeights(normalizedWeights);
      
      // Should be proportional
      expect(normalizedWeights.time).toBeCloseTo(0.5, 2);
      expect(normalizedWeights.cost).toBeCloseTo(0.333, 2);
      expect(normalizedWeights.co2).toBeCloseTo(0.167, 2);
    });
  });

  describe('Plan Comparison', () => {
    it('should compare two plans and recommend lower score', () => {
      const truckPlan: TransportPlan = {
        plan: PlanType.TRUCK,
        timeH: 7.2,
        costJpy: 15600,
        co2Kg: 26
      };

      const shipPlan: TransportPlan = {
        plan: PlanType.TRUCK_SHIP,
        timeH: 21.4,
        costJpy: 6280,
        co2Kg: 5.26
      };

      const weights: WeightFactors = {
        time: 0.7, // Heavy time priority
        cost: 0.2,
        co2: 0.1
      };

      const result = optimizer.comparePlans([truckPlan, shipPlan], weights);

      expect(result.recommendation).toBe(PlanType.TRUCK);
      expect(result.scores).toHaveProperty('truck');
      expect(result.scores).toHaveProperty('truck+ship');
      expect(result.scores.truck).toBeLessThan(result.scores['truck+ship']);
    });

    it('should handle CO2 priority correctly', () => {
      const truckPlan: TransportPlan = {
        plan: PlanType.TRUCK,
        timeH: 7.2,
        costJpy: 15600,
        co2Kg: 26
      };

      const shipPlan: TransportPlan = {
        plan: PlanType.TRUCK_SHIP,
        timeH: 21.4,
        costJpy: 6280,
        co2Kg: 5.26
      };

      const weights: WeightFactors = {
        time: 0.1,
        cost: 0.2,
        co2: 0.7 // Heavy CO2 priority
      };

      const result = optimizer.comparePlans([truckPlan, shipPlan], weights);

      expect(result.recommendation).toBe(PlanType.TRUCK_SHIP);
      expect(result.scores['truck+ship']).toBeLessThan(result.scores.truck);
    });

    it('should handle balanced weights scenario', () => {
      const truckPlan: TransportPlan = {
        plan: PlanType.TRUCK,
        timeH: 7.2,
        costJpy: 15600,
        co2Kg: 26
      };

      const shipPlan: TransportPlan = {
        plan: PlanType.TRUCK_SHIP,
        timeH: 21.4,
        costJpy: 6280,
        co2Kg: 5.26
      };

      const weights: WeightFactors = {
        time: 0.33,
        cost: 0.33,
        co2: 0.34
      };

      const result = optimizer.comparePlans([truckPlan, shipPlan], weights);

      // With balanced weights, should consider all factors
      expect(result.recommendation).toBeDefined();
      expect([PlanType.TRUCK, PlanType.TRUCK_SHIP]).toContain(result.recommendation);
    });
  });

  describe('Normalization Methods', () => {
    it('should apply min-max normalization correctly', () => {
      const plans: TransportPlan[] = [
        { plan: PlanType.TRUCK, timeH: 7.2, costJpy: 15600, co2Kg: 26 },
        { plan: PlanType.TRUCK_SHIP, timeH: 21.4, costJpy: 6280, co2Kg: 5.26 }
      ];

      const normalized = optimizer.normalizeMetrics(plans);

      // Time: min=7.2, max=21.4
      // Truck should have normalized time = 0
      // Ship should have normalized time = 1
      expect(normalized[0].normalizedTime).toBeCloseTo(0, 2);
      expect(normalized[1].normalizedTime).toBeCloseTo(1, 2);

      // Cost: min=6280, max=15600
      // Truck should have normalized cost = 1
      // Ship should have normalized cost = 0
      expect(normalized[0].normalizedCost).toBeCloseTo(1, 2);
      expect(normalized[1].normalizedCost).toBeCloseTo(0, 2);

      // CO2: min=5.26, max=26
      // Truck should have normalized CO2 = 1
      // Ship should have normalized CO2 = 0
      expect(normalized[0].normalizedCo2).toBeCloseTo(1, 2);
      expect(normalized[1].normalizedCo2).toBeCloseTo(0, 2);
    });

    it('should handle z-score normalization', () => {
      optimizer = new ScoreOptimizer({
        normalizationMethod: 'z-score',
        epsilon: 0.001
      });

      const plans: TransportPlan[] = [
        { plan: PlanType.TRUCK, timeH: 7.2, costJpy: 15600, co2Kg: 26 },
        { plan: PlanType.TRUCK_SHIP, timeH: 21.4, costJpy: 6280, co2Kg: 5.26 },
        { plan: PlanType.TRUCK, timeH: 8.5, costJpy: 14000, co2Kg: 22 }
      ];

      const normalized = optimizer.normalizeMetrics(plans);

      // Check that mean is approximately 0 and std is approximately 1
      const timeMean = normalized.reduce((sum: number, p: any) => sum + p.normalizedTime, 0) / normalized.length;
      expect(Math.abs(timeMean)).toBeLessThan(0.1);
    });

    it('should handle identical values in normalization', () => {
      const plans: TransportPlan[] = [
        { plan: PlanType.TRUCK, timeH: 10, costJpy: 10000, co2Kg: 20 },
        { plan: PlanType.TRUCK_SHIP, timeH: 10, costJpy: 10000, co2Kg: 20 }
      ];

      const normalized = optimizer.normalizeMetrics(plans);

      // When all values are identical, normalized values should be 0 or 0.5
      expect(normalized[0].normalizedTime).toBe(normalized[1].normalizedTime);
      expect(normalized[0].normalizedCost).toBe(normalized[1].normalizedCost);
      expect(normalized[0].normalizedCo2).toBe(normalized[1].normalizedCo2);
    });
  });

  describe('Recommendation Logic', () => {
    it('should generate complete comparison result', () => {
      const truckPlan: TransportPlan = {
        plan: PlanType.TRUCK,
        timeH: 7.2,
        costJpy: 15600,
        co2Kg: 26
      };

      const shipPlan: TransportPlan = {
        plan: PlanType.TRUCK_SHIP,
        timeH: 21.4,
        costJpy: 6280,
        co2Kg: 5.26,
        legs: [
          { from: 'Tokyo', to: 'Tokyo Port', mode: 'truck' as any, distanceKm: 20, timeHours: 0.5 },
          { from: 'Tokyo Port', to: 'Osaka Port', mode: 'ship' as any, distanceKm: 400, timeHours: 20 },
          { from: 'Osaka Port', to: 'Osaka', mode: 'truck' as any, distanceKm: 15, timeHours: 0.9 }
        ]
      };

      const weights: WeightFactors = {
        time: 0.5,
        cost: 0.3,
        co2: 0.2
      };

      const result = optimizer.generateComparisonResult(
        [truckPlan, shipPlan],
        weights,
        {
          truckDistance: 520,
          calculationTimeMs: 150
        }
      );

      // Check structure
      expect(result).toHaveProperty('candidates');
      expect(result).toHaveProperty('recommendation');
      expect(result).toHaveProperty('rationale');
      expect(result).toHaveProperty('metadata');

      // Check candidates
      expect(result.candidates).toHaveLength(2);
      expect(result.candidates[0]).toBe(truckPlan);
      expect(result.candidates[1]).toBe(shipPlan);

      // Check recommendation
      expect([PlanType.TRUCK, PlanType.TRUCK_SHIP]).toContain(result.recommendation);

      // Check rationale
      if (result.rationale.truck) {
        expect(result.rationale.truck.distanceKm).toBe(520);
      }
      if (result.rationale['truck+ship']) {
        expect(result.rationale['truck+ship'].legs).toHaveLength(3);
      }

      // Check metadata
      if (result.metadata) {
        expect(result.metadata.calculationTimeMs).toBe(150);
      }
    });

    it('should handle tie-breaking consistently', () => {
      const plan1: TransportPlan = {
        plan: PlanType.TRUCK,
        timeH: 10,
        costJpy: 10000,
        co2Kg: 20
      };

      const plan2: TransportPlan = {
        plan: PlanType.TRUCK_SHIP,
        timeH: 10,
        costJpy: 10000,
        co2Kg: 20
      };

      const weights: WeightFactors = {
        time: 0.33,
        cost: 0.33,
        co2: 0.34
      };

      // Run multiple times to check consistency
      const results: any[] = [];
      for (let i = 0; i < 10; i++) {
        const result = optimizer.comparePlans([plan1, plan2], weights);
        results.push(result.recommendation);
      }

      // Should always return the same recommendation for identical inputs
      const uniqueRecommendations = new Set(results);
      expect(uniqueRecommendations.size).toBe(1);
    });

    it('should provide detailed score breakdown', () => {
      const truckPlan: TransportPlan = {
        plan: PlanType.TRUCK,
        timeH: 7.2,
        costJpy: 15600,
        co2Kg: 26
      };

      const shipPlan: TransportPlan = {
        plan: PlanType.TRUCK_SHIP,
        timeH: 21.4,
        costJpy: 6280,
        co2Kg: 5.26
      };

      const weights: WeightFactors = {
        time: 0.5,
        cost: 0.3,
        co2: 0.2
      };

      const breakdown = optimizer.getScoreBreakdown([truckPlan, shipPlan], weights);

      expect(breakdown.truck).toHaveProperty('timeComponent');
      expect(breakdown.truck).toHaveProperty('costComponent');
      expect(breakdown.truck).toHaveProperty('co2Component');
      expect(breakdown.truck).toHaveProperty('totalScore');

      expect(breakdown['truck+ship']).toHaveProperty('timeComponent');
      expect(breakdown['truck+ship']).toHaveProperty('costComponent');
      expect(breakdown['truck+ship']).toHaveProperty('co2Component');
      expect(breakdown['truck+ship']).toHaveProperty('totalScore');

      // Components should sum to total
      const truckTotal = breakdown.truck.timeComponent + 
                        breakdown.truck.costComponent + 
                        breakdown.truck.co2Component;
      assertApproximatelyEqual(truckTotal, breakdown.truck.totalScore, 0.001);
    });
  });

  describe('Edge Cases', () => {
    it('should handle single plan input', () => {
      const plan: TransportPlan = {
        plan: PlanType.TRUCK,
        timeH: 7.2,
        costJpy: 15600,
        co2Kg: 26
      };

      const weights: WeightFactors = {
        time: 0.5,
        cost: 0.3,
        co2: 0.2
      };

      const result = optimizer.comparePlans([plan], weights);

      expect(result.recommendation).toBe(PlanType.TRUCK);
      expect(result.scores.truck).toBeDefined();
    });

    it('should handle zero weights gracefully', () => {
      const plan: TransportPlan = {
        plan: PlanType.TRUCK,
        timeH: 7.2,
        costJpy: 15600,
        co2Kg: 26
      };

      const zeroWeights: WeightFactors = {
        time: 0,
        cost: 0,
        co2: 0
      };

      const normalizedWeights = optimizer.normalizeWeights(zeroWeights);

      // Should default to balanced weights
      expect(normalizedWeights.time).toBeCloseTo(0.33, 2);
      expect(normalizedWeights.cost).toBeCloseTo(0.33, 2);
      expect(normalizedWeights.co2).toBeCloseTo(0.34, 2);
    });

    it('should handle negative values with error', () => {
      const invalidPlan: TransportPlan = {
        plan: PlanType.TRUCK,
        timeH: -7.2,
        costJpy: 15600,
        co2Kg: 26
      };

      const weights: WeightFactors = {
        time: 0.5,
        cost: 0.3,
        co2: 0.2
      };

      expect(() => optimizer.calculateScore(invalidPlan, weights))
        .toThrow('Invalid metric values');
    });

    it('should handle very large numbers', () => {
      const plan: TransportPlan = {
        plan: PlanType.TRUCK,
        timeH: 999999,
        costJpy: 999999999,
        co2Kg: 999999
      };

      const weights: WeightFactors = {
        time: 0.5,
        cost: 0.3,
        co2: 0.2
      };

      const score = optimizer.calculateScore(plan, weights);

      expect(score).toBeGreaterThan(0);
      expect(Number.isFinite(score)).toBe(true);
    });

    it('should handle very small differences', () => {
      const plan1: TransportPlan = {
        plan: PlanType.TRUCK,
        timeH: 10.0000,
        costJpy: 10000,
        co2Kg: 20.0000
      };

      const plan2: TransportPlan = {
        plan: PlanType.TRUCK_SHIP,
        timeH: 10.0001,
        costJpy: 10000,
        co2Kg: 20.0001
      };

      const weights: WeightFactors = {
        time: 0.5,
        cost: 0.3,
        co2: 0.2
      };

      const result = optimizer.comparePlans([plan1, plan2], weights);

      // Should still make a recommendation even with tiny differences
      expect(result.recommendation).toBeDefined();
    });
  });

  describe('Sensitivity Analysis', () => {
    it('should show how recommendation changes with weight adjustments', () => {
      // TODO(#issue-2): Implement complete sensitivity analysis with threshold properties
      // Missing: timeThreshold, costThreshold, co2Threshold
      const truckPlan: TransportPlan = {
        plan: PlanType.TRUCK,
        timeH: 7.2,
        costJpy: 15600,
        co2Kg: 26
      };

      const shipPlan: TransportPlan = {
        plan: PlanType.TRUCK_SHIP,
        timeH: 21.4,
        costJpy: 6280,
        co2Kg: 5.26
      };

      const sensitivity = optimizer.analyzeSensitivity([truckPlan, shipPlan]);

      // Should identify weight thresholds where recommendation changes
      expect(sensitivity).toHaveProperty('timeThreshold');
      expect(sensitivity).toHaveProperty('costThreshold');
      expect(sensitivity).toHaveProperty('co2Threshold');

      // Thresholds should be between 0 and 1
      if (sensitivity.timeThreshold !== null) {
        expect(sensitivity.timeThreshold).toBeGreaterThanOrEqual(0);
        expect(sensitivity.timeThreshold).toBeLessThanOrEqual(1);
      }
    });

    it('should identify dominant factors', () => {
      // TODO(#issue-2): Fix weights parameter handling in identifyDominantFactors
      // Currently throws: Cannot read properties of undefined
      const truckPlan: TransportPlan = {
        plan: PlanType.TRUCK,
        timeH: 7.2,
        costJpy: 15600,
        co2Kg: 26
      };

      const shipPlan: TransportPlan = {
        plan: PlanType.TRUCK_SHIP,
        timeH: 21.4,  // 3x slower
        costJpy: 6280,  // 60% cheaper
        co2Kg: 5.26   // 80% less CO2
      };

      const factors = optimizer.identifyDominantFactors([truckPlan, shipPlan]);

      expect(factors.truck).toContain('time');
      expect(factors['truck+ship']).toContain('cost');
      expect(factors['truck+ship']).toContain('co2');
    });
  });

  describe('Performance Optimization', () => {
    it('should cache normalized values for repeated calculations', () => {
      const plans: TransportPlan[] = [
        { plan: PlanType.TRUCK, timeH: 7.2, costJpy: 15600, co2Kg: 26 },
        { plan: PlanType.TRUCK_SHIP, timeH: 21.4, costJpy: 6280, co2Kg: 5.26 }
      ];

      const weights: WeightFactors = {
        time: 0.5,
        cost: 0.3,
        co2: 0.2
      };

      const startTime = Date.now();
      
      // First calculation
      optimizer.comparePlans(plans, weights);
      
      // Repeated calculations should use cache
      for (let i = 0; i < 100; i++) {
        optimizer.comparePlans(plans, weights);
      }
      
      const duration = Date.now() - startTime;

      // Should complete quickly due to caching
      expect(duration).toBeLessThan(100);
    });

    it('should handle batch comparisons efficiently', () => {
      // TODO(#issue-2): Fix async/await handling in batchCompare
      // Test needs to await the Promise properly
      const scenarios = [
        { weights: { time: 0.7, cost: 0.2, co2: 0.1 } },
        { weights: { time: 0.1, cost: 0.2, co2: 0.7 } },
        { weights: { time: 0.33, cost: 0.33, co2: 0.34 } },
        { weights: { time: 0.5, cost: 0.4, co2: 0.1 } },
        { weights: { time: 0.2, cost: 0.6, co2: 0.2 } }
      ];

      const plans: TransportPlan[] = [
        { plan: PlanType.TRUCK, timeH: 7.2, costJpy: 15600, co2Kg: 26 },
        { plan: PlanType.TRUCK_SHIP, timeH: 21.4, costJpy: 6280, co2Kg: 5.26 }
      ];

      const results = optimizer.batchCompare(plans, scenarios.map((s: any) => s.weights));

      expect(results).toHaveLength(5);
      results.forEach((result: any) => {
        expect(result).toHaveProperty('recommendation');
        expect(result).toHaveProperty('scores');
      });
    });
  });
});