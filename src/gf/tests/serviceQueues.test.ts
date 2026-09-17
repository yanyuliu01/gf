/**
 * M21-011: Service Queues and Boundary Nodes Tests.
 *
 * Tests for:
 * - Ecology department staff/instrument/budget/procurement queues
 * - Bounded Trimounts transport, supplier, weather, and service boundary nodes
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  ServiceQueue,
  TransportNode,
  SupplierNode,
  WeatherNode,
  createDefaultServiceQueues,
  createDefaultBoundaryNodes,
  type ServiceQueueConfig,
  type TransportNodeConfig,
  type SupplierNodeConfig,
  type WeatherNodeConfig,
} from "../world/serviceQueues.js";

const workdayOpeningWindows = [
  { dayOfWeek: 1 as const, startHour: 8, endHour: 18 },
  { dayOfWeek: 2 as const, startHour: 8, endHour: 18 },
  { dayOfWeek: 3 as const, startHour: 8, endHour: 18 },
  { dayOfWeek: 4 as const, startHour: 8, endHour: 18 },
  { dayOfWeek: 5 as const, startHour: 8, endHour: 18 },
];

function makeQueueConfig(overrides: Partial<ServiceQueueConfig> = {}): ServiceQueueConfig {
  return {
    queueId: "test_queue",
    name: "Test Queue",
    capacity: 2,
    discipline: "fifo",
    openingWindows: workdayOpeningWindows,
    baseServiceTimeMinutes: 30,
    serviceTimeVariance: 10,
    maintenanceFrequencyDays: 7,
    failureProbabilityPerDay: 0.01,
    priorityLevels: 3,
    ...overrides,
  };
}

function makeTransportConfig(overrides: Partial<TransportNodeConfig> = {}): TransportNodeConfig {
  return {
    nodeId: "test_transport",
    name: "Test Transport",
    baseTravelTimeMinutes: 20,
    moneyCost: 10,
    openingWindows: workdayOpeningWindows,
    capacity: 50,
    weatherSensitivity: 0.5,
    ...overrides,
  };
}

function makeSupplierConfig(overrides: Partial<SupplierNodeConfig> = {}): SupplierNodeConfig {
  return {
    nodeId: "test_supplier",
    name: "Test Supplier",
    resourceTypeId: "test_resource",
    basePrice: 100,
    priceVolatility: 0.1,
    baseDeliveryDays: 3,
    deliveryVariance: 1,
    stockLevel: "normal",
    openingWindows: workdayOpeningWindows,
    ...overrides,
  };
}

function makeWeatherConfig(overrides: Partial<WeatherNodeConfig> = {}): WeatherNodeConfig {
  return {
    nodeId: "test_weather",
    name: "Test Weather Station",
    seasonalBias: 0.5,
    stormProbability: 0.1,
    temperatureRange: [10, 25],
    ...overrides,
  };
}

describe("ServiceQueue", () => {
  test("initializes with available status", () => {
    const queue = new ServiceQueue(makeQueueConfig());
    const state = queue.getState();

    assert.equal(state.status, "available");
    assert.equal(state.waitingQueue.length, 0);
    assert.equal(state.currentServicing.length, 0);
  });

  test("enqueues requests during open hours", () => {
    const queue = new ServiceQueue(makeQueueConfig());
    const mondayMorning = "2026-09-21T10:00:00Z";

    const result = queue.enqueue(
      "requester_1",
      0,
      [{ source_type: "event", source_id: "evt_1" }],
      mondayMorning,
    );

    assert.ok(result.accepted);
    assert.ok(result.entryId);
    assert.equal(result.position, 1);
    assert.equal(queue.getState().waitingQueue.length, 1);
  });

  test("rejects requests when closed", () => {
    const queue = new ServiceQueue(makeQueueConfig());
    const sundayMorning = "2026-09-20T10:00:00Z";

    const result = queue.enqueue(
      "requester_1",
      0,
      [{ source_type: "event", source_id: "evt_1" }],
      sundayMorning,
    );

    assert.equal(result.accepted, false);
    assert.ok(result.error?.includes("closed"));
  });

  test("FIFO discipline maintains order", () => {
    const queue = new ServiceQueue(makeQueueConfig({ discipline: "fifo" }));
    const time = "2026-09-21T10:00:00Z";

    queue.enqueue("req_1", 0, [{ source_type: "event", source_id: "e1" }], time);
    queue.enqueue("req_2", 0, [{ source_type: "event", source_id: "e2" }], time);
    queue.enqueue("req_3", 0, [{ source_type: "event", source_id: "e3" }], time);

    const state = queue.getState();
    assert.equal(state.waitingQueue[0].requesterId, "req_1");
    assert.equal(state.waitingQueue[1].requesterId, "req_2");
    assert.equal(state.waitingQueue[2].requesterId, "req_3");
  });

  test("priority discipline orders by priority", () => {
    const queue = new ServiceQueue(makeQueueConfig({ discipline: "priority" }));
    const time = "2026-09-21T10:00:00Z";

    queue.enqueue("req_low", 2, [{ source_type: "event", source_id: "e1" }], time);
    queue.enqueue("req_high", 0, [{ source_type: "event", source_id: "e2" }], time);
    queue.enqueue("req_mid", 1, [{ source_type: "event", source_id: "e3" }], time);

    const state = queue.getState();
    assert.equal(state.waitingQueue[0].requesterId, "req_high");
    assert.equal(state.waitingQueue[1].requesterId, "req_mid");
    assert.equal(state.waitingQueue[2].requesterId, "req_low");
  });

  test("starts service when capacity available", () => {
    const queue = new ServiceQueue(makeQueueConfig({ capacity: 2 }));
    const time = "2026-09-21T10:00:00Z";

    queue.enqueue("req_1", 0, [{ source_type: "event", source_id: "e1" }], time);

    const result = queue.startService(time);

    assert.ok(result);
    assert.equal(result.completed, false);
    assert.equal(queue.getState().currentServicing.length, 1);
    assert.equal(queue.getState().waitingQueue.length, 0);
  });

  test("respects capacity limit", () => {
    const queue = new ServiceQueue(makeQueueConfig({ capacity: 1 }));
    const time = "2026-09-21T10:00:00Z";

    queue.enqueue("req_1", 0, [{ source_type: "event", source_id: "e1" }], time);
    queue.enqueue("req_2", 0, [{ source_type: "event", source_id: "e2" }], time);

    queue.startService(time);
    const result = queue.startService(time);

    assert.equal(result, null);
    assert.equal(queue.getState().currentServicing.length, 1);
    assert.equal(queue.getState().waitingQueue.length, 1);
  });

  test("completes service", () => {
    const queue = new ServiceQueue(makeQueueConfig());
    const time = "2026-09-21T10:00:00Z";

    queue.enqueue("req_1", 0, [{ source_type: "event", source_id: "e1" }], time);
    const startResult = queue.startService(time);
    assert.ok(startResult);

    const completeResult = queue.completeService(startResult.entryId);

    assert.ok(completeResult);
    assert.equal(completeResult.completed, true);
    assert.equal(queue.getState().currentServicing.length, 0);
  });

  test("setStatus changes queue status", () => {
    const queue = new ServiceQueue(makeQueueConfig());

    queue.setStatus("maintenance");
    assert.equal(queue.getState().status, "maintenance");

    const time = "2026-09-21T10:00:00Z";
    const result = queue.enqueue(
      "req_1",
      0,
      [{ source_type: "event", source_id: "e1" }],
      time,
    );

    assert.equal(result.accepted, false);
    assert.ok(result.error?.includes("maintenance"));
  });
});

describe("TransportNode", () => {
  test("initializes with operational status", () => {
    const node = new TransportNode(makeTransportConfig());
    const state = node.getState();

    assert.equal(state.isOperational, true);
    assert.equal(state.currentCondition, "clear");
    assert.equal(state.congestionFactor, 1.0);
  });

  test("calculates travel time with weather factor", () => {
    const node = new TransportNode(makeTransportConfig({
      baseTravelTimeMinutes: 20,
      weatherSensitivity: 0.5,
    }));
    const time = "2026-09-21T10:00:00Z";

    const clearResult = node.travel(time, "seed_1");
    assert.ok(clearResult.success);
    assert.ok(clearResult.actualTimeMinutes >= 20);

    node.updateConditions("storm", 1.0);
    const stormResult = node.travel(time, "seed_1");
    assert.ok(stormResult.success);
    assert.ok(stormResult.actualTimeMinutes > clearResult.actualTimeMinutes);
  });

  test("rejects travel when not operational", () => {
    const node = new TransportNode(makeTransportConfig());
    const time = "2026-09-21T10:00:00Z";

    node.setOperational(false);
    const result = node.travel(time, "seed_1");

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("Not operational"));
  });

  test("rejects travel when closed", () => {
    const node = new TransportNode(makeTransportConfig());
    const sunday = "2026-09-20T10:00:00Z";

    const result = node.travel(sunday, "seed_1");

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("Closed"));
  });

  test("congestion affects travel time", () => {
    const node = new TransportNode(makeTransportConfig({ baseTravelTimeMinutes: 20 }));
    const time = "2026-09-21T10:00:00Z";

    const normalResult = node.travel(time, "seed_1");

    node.updateConditions("clear", 1.5);
    const congestedResult = node.travel(time, "seed_1");

    assert.ok(congestedResult.actualTimeMinutes > normalResult.actualTimeMinutes);
  });

  test("deterministic travel with same seed", () => {
    const node = new TransportNode(makeTransportConfig());
    const time = "2026-09-21T10:00:00Z";

    const result1 = node.travel(time, "seed_xyz");
    const result2 = node.travel(time, "seed_xyz");

    assert.equal(result1.actualTimeMinutes, result2.actualTimeMinutes);
  });
});

describe("SupplierNode", () => {
  test("initializes with configured values", () => {
    const node = new SupplierNode(makeSupplierConfig({ basePrice: 150 }));
    const state = node.getState();

    assert.equal(state.currentPrice, 150);
    assert.equal(state.stockLevel, "normal");
    assert.equal(state.pendingOrders.length, 0);
  });

  test("places order during open hours", () => {
    const node = new SupplierNode(makeSupplierConfig());
    const monday = "2026-09-21T10:00:00Z";

    const result = node.placeOrder(5, monday, "seed_1");

    assert.ok(result.success);
    assert.ok(result.orderId);
    assert.ok(result.price);
    assert.ok(result.expectedDeliveryAt);
    assert.equal(node.getState().pendingOrders.length, 1);
  });

  test("rejects order when closed", () => {
    const node = new SupplierNode(makeSupplierConfig());
    const sunday = "2026-09-20T10:00:00Z";

    const result = node.placeOrder(5, sunday, "seed_1");

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("closed"));
  });

  test("rejects order when out of stock", () => {
    const node = new SupplierNode(makeSupplierConfig({ stockLevel: "out_of_stock" }));
    const monday = "2026-09-21T10:00:00Z";

    const result = node.placeOrder(5, monday, "seed_1");

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("Out of stock"));
  });

  test("processes deliveries when due", () => {
    const node = new SupplierNode(makeSupplierConfig({ baseDeliveryDays: 1, deliveryVariance: 0 }));
    const orderTime = "2026-09-21T10:00:00Z";

    node.placeOrder(5, orderTime, "seed_1");
    assert.equal(node.getState().pendingOrders.length, 1);

    const beforeDelivery = "2026-09-21T12:00:00Z";
    let delivered = node.processDeliveries(beforeDelivery);
    assert.equal(delivered.length, 0);

    const afterDelivery = "2026-09-23T10:00:00Z";
    delivered = node.processDeliveries(afterDelivery);
    assert.equal(delivered.length, 1);
    assert.equal(node.getState().pendingOrders.length, 0);
  });

  test("price updates with bounded volatility", () => {
    const node = new SupplierNode(makeSupplierConfig({
      basePrice: 100,
      priceVolatility: 0.2,
    }));

    const initialPrice = node.getState().currentPrice;
    node.updatePrice("seed_abc");
    const newPrice = node.getState().currentPrice;

    assert.ok(newPrice >= 50);
    assert.ok(newPrice <= 200);
    assert.notEqual(newPrice, initialPrice);
  });

  test("stock level affects delivery time", () => {
    const highStockNode = new SupplierNode(makeSupplierConfig({ stockLevel: "high" }));
    const lowStockNode = new SupplierNode(makeSupplierConfig({ stockLevel: "low" }));
    const monday = "2026-09-21T10:00:00Z";

    const highResult = highStockNode.placeOrder(1, monday, "same_seed");
    const lowResult = lowStockNode.placeOrder(1, monday, "same_seed");

    assert.ok(highResult.success && lowResult.success);

    const highDelivery = new Date(highResult.expectedDeliveryAt!);
    const lowDelivery = new Date(lowResult.expectedDeliveryAt!);

    assert.ok(lowDelivery >= highDelivery);
  });
});

describe("WeatherNode", () => {
  test("initializes with clear conditions", () => {
    const node = new WeatherNode(makeWeatherConfig());
    const state = node.getState();

    assert.equal(state.currentCondition, "clear");
    assert.ok(state.temperature >= 10 && state.temperature <= 25);
  });

  test("updates weather deterministically", () => {
    const node1 = new WeatherNode(makeWeatherConfig());
    const node2 = new WeatherNode(makeWeatherConfig());
    const time = "2026-09-21T10:00:00Z";

    node1.update(time, "weather_seed_123");
    node2.update(time, "weather_seed_123");

    assert.equal(node1.getState().currentCondition, node2.getState().currentCondition);
    assert.equal(node1.getState().temperature, node2.getState().temperature);
  });

  test("different seeds produce different weather", () => {
    const node = new WeatherNode(makeWeatherConfig());
    const time = "2026-09-21T10:00:00Z";

    node.update(time, "seed_alpha");
    const state1 = { ...node.getState() };

    node.update(time, "seed_beta");
    const state2 = node.getState();

    const conditionsDiffer = state1.currentCondition !== state2.currentCondition;
    const tempDiffers = state1.temperature !== state2.temperature;

    assert.ok(conditionsDiffer || tempDiffers, "Different seeds should produce different weather");
  });

  test("calculates ecology garden effects", () => {
    const node = new WeatherNode(makeWeatherConfig({ temperatureRange: [20, 25] }));

    const effects = node.affectsEcologyGarden();

    assert.ok(typeof effects.irrigationModifier === "number");
    assert.ok(typeof effects.energyModifier === "number");
    assert.ok(typeof effects.growthModifier === "number");
    assert.ok(effects.irrigationModifier > 0);
    assert.ok(effects.energyModifier > 0);
    assert.ok(effects.growthModifier > 0);
  });

  test("storm increases energy modifier", () => {
    const node = new WeatherNode(makeWeatherConfig({ stormProbability: 1.0 }));
    node.update("2026-09-21T10:00:00Z", "any_seed");

    assert.equal(node.getState().currentCondition, "storm");

    const effects = node.affectsEcologyGarden();
    assert.ok(effects.energyModifier > 1.0);
  });
});

describe("Default Configurations", () => {
  test("creates default service queues", () => {
    const queues = createDefaultServiceQueues();

    assert.equal(queues.length, 3);

    const instrumentQueue = queues.find((q) => q.getState().config.queueId === "instrument_queue");
    assert.ok(instrumentQueue);
    assert.equal(instrumentQueue.getState().config.discipline, "reservation");

    const technicianQueue = queues.find((q) => q.getState().config.queueId === "technician_queue");
    assert.ok(technicianQueue);
    assert.equal(technicianQueue.getState().config.discipline, "priority");

    const approvalQueue = queues.find((q) => q.getState().config.queueId === "approval_queue");
    assert.ok(approvalQueue);
    assert.equal(approvalQueue.getState().config.discipline, "fifo");
  });

  test("creates default boundary nodes", () => {
    const { transport, suppliers, weather } = createDefaultBoundaryNodes();

    assert.equal(transport.length, 2);
    assert.equal(suppliers.length, 2);
    assert.ok(weather);

    const metro = transport.find((t) => t.getState().config.nodeId === "trimounts_metro");
    assert.ok(metro);

    const shuttle = transport.find((t) => t.getState().config.nodeId === "rhine_shuttle");
    assert.ok(shuttle);
    assert.equal(shuttle.getState().config.moneyCost, 0);

    const labSupplier = suppliers.find(
      (s) => s.getState().config.nodeId === "lab_supplies_vendor",
    );
    assert.ok(labSupplier);

    const partsSupplier = suppliers.find(
      (s) => s.getState().config.nodeId === "equipment_parts_vendor",
    );
    assert.ok(partsSupplier);

    assert.equal(weather.getState().config.nodeId, "trimounts_weather");
  });
});

describe("Integration: Queue and Boundary Node Interaction", () => {
  test("weather affects transport then queue availability", () => {
    const { transport, weather } = createDefaultBoundaryNodes();
    const metro = transport[0];
    const time = "2026-09-21T10:00:00Z";

    weather.update(time, "storm_seed");
    metro.updateConditions(weather.getState().currentCondition, 1.0);

    const travelResult = metro.travel(time, "travel_seed");
    assert.ok(travelResult.success);

    if (weather.getState().currentCondition === "storm") {
      assert.ok(travelResult.actualTimeMinutes > metro.getState().config.baseTravelTimeMinutes);
    }
  });

  test("supplier order flows to delivery", () => {
    const { suppliers } = createDefaultBoundaryNodes();
    const labSupplier = suppliers[0];
    const orderTime = "2026-09-21T10:00:00Z";

    const orderResult = labSupplier.placeOrder(10, orderTime, "order_seed");
    assert.ok(orderResult.success);

    const deliveryTime = orderResult.expectedDeliveryAt!;
    const delivered = labSupplier.processDeliveries(deliveryTime);

    assert.equal(delivered.length, 1);
    assert.equal(delivered[0], orderResult.orderId);
  });
});
