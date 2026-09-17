/**
 * M21-011: Service Queues and Boundary Nodes.
 *
 * Implements:
 * - Ecology department staff/instrument/budget/procurement queues
 * - Bounded Trimounts transport, supplier, weather, and service boundary nodes
 * - Macro-economy remains outside scope (external boundary nodes only)
 *
 * Queue disciplines from docs/16 section 4.3:
 * - Simultaneous service capacity
 * - Opening hours
 * - Queue discipline (FIFO, priority, reservation)
 * - Service time distribution
 * - Maintenance and failure rules
 * - Who can change queue order
 */

import type { SourceRef } from "../generated/worldRuntimeTypes.js";
import { newId, utcnowIso } from "../domain/ids.js";
import { createHash } from "node:crypto";

export type QueueDiscipline = "fifo" | "priority" | "reservation";

export type ServiceStatus =
  | "available"
  | "busy"
  | "maintenance"
  | "offline"
  | "closed";

export interface OpeningWindow {
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  startHour: number;
  endHour: number;
}

export interface ServiceQueueConfig {
  queueId: string;
  name: string;
  capacity: number;
  discipline: QueueDiscipline;
  openingWindows: readonly OpeningWindow[];
  baseServiceTimeMinutes: number;
  serviceTimeVariance: number;
  maintenanceFrequencyDays: number;
  failureProbabilityPerDay: number;
  priorityLevels: number;
}

export interface QueueEntry {
  entryId: string;
  requesterId: string;
  priority: number;
  requestedAt: string;
  estimatedServiceTimeMinutes: number;
  sourceRefs: readonly SourceRef[];
}

export interface ServiceQueueState {
  config: ServiceQueueConfig;
  status: ServiceStatus;
  currentServicing: readonly string[];
  waitingQueue: readonly QueueEntry[];
  nextMaintenanceAt: string | null;
  lastFailureAt: string | null;
  revision: number;
}

export interface QueueResult {
  accepted: boolean;
  entryId?: string;
  estimatedWaitMinutes?: number;
  position?: number;
  error?: string;
}

export interface ServiceResult {
  completed: boolean;
  entryId: string;
  actualServiceTimeMinutes: number;
  success: boolean;
  error?: string;
}

export class ServiceQueue {
  private state: ServiceQueueState;

  constructor(config: ServiceQueueConfig) {
    this.state = {
      config,
      status: "available",
      currentServicing: [],
      waitingQueue: [],
      nextMaintenanceAt: null,
      lastFailureAt: null,
      revision: 0,
    };
  }

  getState(): Readonly<ServiceQueueState> {
    return this.state;
  }

  isOpen(currentTime: string): boolean {
    const date = new Date(currentTime);
    const dayOfWeek = date.getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    const hour = date.getUTCHours();

    return this.state.config.openingWindows.some(
      (w) => w.dayOfWeek === dayOfWeek && hour >= w.startHour && hour < w.endHour,
    );
  }

  enqueue(
    requesterId: string,
    priority: number,
    sourceRefs: readonly SourceRef[],
    currentTime: string,
  ): QueueResult {
    if (this.state.status === "offline" || this.state.status === "maintenance") {
      return { accepted: false, error: `Queue is ${this.state.status}` };
    }

    if (!this.isOpen(currentTime)) {
      return { accepted: false, error: "Queue is closed" };
    }

    const entryId = newId("qe");
    const entry: QueueEntry = {
      entryId,
      requesterId,
      priority: Math.min(priority, this.state.config.priorityLevels - 1),
      requestedAt: currentTime,
      estimatedServiceTimeMinutes: this.state.config.baseServiceTimeMinutes,
      sourceRefs: [...sourceRefs],
    };

    let insertIndex = this.state.waitingQueue.length;
    if (this.state.config.discipline === "priority") {
      insertIndex = this.state.waitingQueue.findIndex((e) => e.priority > entry.priority);
      if (insertIndex === -1) insertIndex = this.state.waitingQueue.length;
    }

    const newQueue = [...this.state.waitingQueue];
    newQueue.splice(insertIndex, 0, entry);

    this.state = {
      ...this.state,
      waitingQueue: newQueue,
      revision: this.state.revision + 1,
    };

    const estimatedWaitMinutes = this.calculateWaitTime(entryId);

    return {
      accepted: true,
      entryId,
      estimatedWaitMinutes,
      position: insertIndex + 1,
    };
  }

  private calculateWaitTime(entryId: string): number {
    const position = this.state.waitingQueue.findIndex((e) => e.entryId === entryId);
    if (position === -1) return 0;

    const aheadEntries = this.state.waitingQueue.slice(0, position);
    const totalAheadTime = aheadEntries.reduce(
      (sum, e) => sum + e.estimatedServiceTimeMinutes,
      0,
    );

    const currentServiceRemaining = this.state.currentServicing.length *
      (this.state.config.baseServiceTimeMinutes / 2);

    return totalAheadTime + currentServiceRemaining;
  }

  startService(currentTime: string): ServiceResult | null {
    if (this.state.waitingQueue.length === 0) return null;
    if (this.state.currentServicing.length >= this.state.config.capacity) return null;
    if (!this.isOpen(currentTime)) return null;
    if (this.state.status !== "available") return null;

    const entry = this.state.waitingQueue[0];
    const newQueue = this.state.waitingQueue.slice(1);
    const newServicing = [...this.state.currentServicing, entry.entryId];

    this.state = {
      ...this.state,
      waitingQueue: newQueue,
      currentServicing: newServicing,
      revision: this.state.revision + 1,
    };

    return {
      completed: false,
      entryId: entry.entryId,
      actualServiceTimeMinutes: entry.estimatedServiceTimeMinutes,
      success: true,
    };
  }

  completeService(entryId: string): ServiceResult | null {
    if (!this.state.currentServicing.includes(entryId)) return null;

    const newServicing = this.state.currentServicing.filter((id) => id !== entryId);

    this.state = {
      ...this.state,
      currentServicing: newServicing,
      revision: this.state.revision + 1,
    };

    return {
      completed: true,
      entryId,
      actualServiceTimeMinutes: this.state.config.baseServiceTimeMinutes,
      success: true,
    };
  }

  setStatus(status: ServiceStatus): void {
    this.state = {
      ...this.state,
      status,
      revision: this.state.revision + 1,
    };
  }
}

export type BoundaryNodeType =
  | "transport"
  | "supplier"
  | "weather"
  | "service"
  | "external";

export type WeatherCondition =
  | "clear"
  | "cloudy"
  | "rain"
  | "storm"
  | "snow"
  | "extreme";

export interface TransportNodeConfig {
  nodeId: string;
  name: string;
  baseTravelTimeMinutes: number;
  moneyCost: number;
  openingWindows: readonly OpeningWindow[];
  capacity: number;
  weatherSensitivity: number;
}

export interface SupplierNodeConfig {
  nodeId: string;
  name: string;
  resourceTypeId: string;
  basePrice: number;
  priceVolatility: number;
  baseDeliveryDays: number;
  deliveryVariance: number;
  stockLevel: "high" | "normal" | "low" | "out_of_stock";
  openingWindows: readonly OpeningWindow[];
}

export interface WeatherNodeConfig {
  nodeId: string;
  name: string;
  seasonalBias: number;
  stormProbability: number;
  temperatureRange: [number, number];
}

export interface TransportNodeState {
  config: TransportNodeConfig;
  currentCondition: WeatherCondition;
  congestionFactor: number;
  isOperational: boolean;
  revision: number;
}

export interface SupplierNodeState {
  config: SupplierNodeConfig;
  currentPrice: number;
  stockLevel: "high" | "normal" | "low" | "out_of_stock";
  pendingOrders: readonly {
    orderId: string;
    amount: number;
    expectedDeliveryAt: string;
  }[];
  revision: number;
}

export interface WeatherNodeState {
  config: WeatherNodeConfig;
  currentCondition: WeatherCondition;
  temperature: number;
  humidity: number;
  lastUpdatedAt: string;
  revision: number;
}

export interface TravelResult {
  success: boolean;
  actualTimeMinutes: number;
  cost: number;
  delayMinutes: number;
  error?: string;
}

export interface PurchaseOrderResult {
  success: boolean;
  orderId?: string;
  price?: number;
  expectedDeliveryAt?: string;
  error?: string;
}

export class TransportNode {
  private state: TransportNodeState;

  constructor(config: TransportNodeConfig) {
    this.state = {
      config,
      currentCondition: "clear",
      congestionFactor: 1.0,
      isOperational: true,
      revision: 0,
    };
  }

  getState(): Readonly<TransportNodeState> {
    return this.state;
  }

  isOpen(currentTime: string): boolean {
    const date = new Date(currentTime);
    const dayOfWeek = date.getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    const hour = date.getUTCHours();

    return this.state.config.openingWindows.some(
      (w) => w.dayOfWeek === dayOfWeek && hour >= w.startHour && hour < w.endHour,
    );
  }

  travel(currentTime: string, seed: string): TravelResult {
    if (!this.state.isOperational) {
      return { success: false, actualTimeMinutes: 0, cost: 0, delayMinutes: 0, error: "Not operational" };
    }

    if (!this.isOpen(currentTime)) {
      return { success: false, actualTimeMinutes: 0, cost: 0, delayMinutes: 0, error: "Closed" };
    }

    const weatherFactor = this.getWeatherFactor();
    const randomDelay = this.getBoundedDelay(seed);

    const actualTime = Math.round(
      this.state.config.baseTravelTimeMinutes *
        this.state.congestionFactor *
        weatherFactor +
        randomDelay,
    );

    const delayMinutes = actualTime - this.state.config.baseTravelTimeMinutes;

    return {
      success: true,
      actualTimeMinutes: actualTime,
      cost: this.state.config.moneyCost,
      delayMinutes: Math.max(0, delayMinutes),
    };
  }

  private getWeatherFactor(): number {
    const sensitivity = this.state.config.weatherSensitivity;
    switch (this.state.currentCondition) {
      case "clear":
        return 1.0;
      case "cloudy":
        return 1.0 + 0.05 * sensitivity;
      case "rain":
        return 1.0 + 0.2 * sensitivity;
      case "storm":
        return 1.0 + 0.5 * sensitivity;
      case "snow":
        return 1.0 + 0.4 * sensitivity;
      case "extreme":
        return 1.0 + 1.0 * sensitivity;
    }
  }

  private getBoundedDelay(seed: string): number {
    const hash = createHash("sha256")
      .update(seed)
      .update(this.state.config.nodeId)
      .digest();
    const normalized = hash.readUInt32BE(0) / 0xffffffff;
    return Math.floor(normalized * 15);
  }

  updateConditions(weather: WeatherCondition, congestion: number): void {
    this.state = {
      ...this.state,
      currentCondition: weather,
      congestionFactor: Math.max(0.5, Math.min(2.0, congestion)),
      revision: this.state.revision + 1,
    };
  }

  setOperational(operational: boolean): void {
    this.state = {
      ...this.state,
      isOperational: operational,
      revision: this.state.revision + 1,
    };
  }
}

export class SupplierNode {
  private state: SupplierNodeState;

  constructor(config: SupplierNodeConfig) {
    this.state = {
      config,
      currentPrice: config.basePrice,
      stockLevel: config.stockLevel,
      pendingOrders: [],
      revision: 0,
    };
  }

  getState(): Readonly<SupplierNodeState> {
    return this.state;
  }

  isOpen(currentTime: string): boolean {
    const date = new Date(currentTime);
    const dayOfWeek = date.getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    const hour = date.getUTCHours();

    return this.state.config.openingWindows.some(
      (w) => w.dayOfWeek === dayOfWeek && hour >= w.startHour && hour < w.endHour,
    );
  }

  placeOrder(
    amount: number,
    currentTime: string,
    seed: string,
  ): PurchaseOrderResult {
    if (!this.isOpen(currentTime)) {
      return { success: false, error: "Supplier is closed" };
    }

    if (this.state.stockLevel === "out_of_stock") {
      return { success: false, error: "Out of stock" };
    }

    const price = this.state.currentPrice * amount;
    const deliveryDays = this.calculateDeliveryTime(seed);
    const deliveryDate = new Date(currentTime);
    deliveryDate.setUTCDate(deliveryDate.getUTCDate() + deliveryDays);

    const orderId = newId("ord");
    const expectedDeliveryAt = deliveryDate.toISOString();

    const newOrders = [
      ...this.state.pendingOrders,
      { orderId, amount, expectedDeliveryAt },
    ];

    this.state = {
      ...this.state,
      pendingOrders: newOrders,
      revision: this.state.revision + 1,
    };

    return {
      success: true,
      orderId,
      price,
      expectedDeliveryAt,
    };
  }

  private calculateDeliveryTime(seed: string): number {
    const hash = createHash("sha256")
      .update(seed)
      .update(this.state.config.nodeId)
      .digest();
    const normalized = hash.readUInt32BE(0) / 0xffffffff;

    const variance = Math.floor(
      (normalized - 0.5) * 2 * this.state.config.deliveryVariance,
    );

    const stockFactor =
      this.state.stockLevel === "high"
        ? 0.8
        : this.state.stockLevel === "low"
          ? 1.5
          : 1.0;

    return Math.max(
      1,
      Math.round((this.state.config.baseDeliveryDays + variance) * stockFactor),
    );
  }

  processDeliveries(currentTime: string): string[] {
    const current = new Date(currentTime).getTime();
    const delivered: string[] = [];
    const remaining: { orderId: string; amount: number; expectedDeliveryAt: string }[] = [];

    for (const order of this.state.pendingOrders) {
      if (new Date(order.expectedDeliveryAt).getTime() <= current) {
        delivered.push(order.orderId);
      } else {
        remaining.push({ ...order });
      }
    }

    if (delivered.length > 0) {
      this.state = {
        ...this.state,
        pendingOrders: remaining,
        revision: this.state.revision + 1,
      };
    }

    return delivered;
  }

  updatePrice(seed: string): void {
    const hash = createHash("sha256")
      .update(seed)
      .update(this.state.config.nodeId)
      .update("price")
      .digest();
    const normalized = hash.readUInt32BE(0) / 0xffffffff;

    const shock = (normalized - 0.5) * 2 * this.state.config.priceVolatility;
    const newPrice = Math.max(
      this.state.config.basePrice * 0.5,
      Math.min(
        this.state.config.basePrice * 2.0,
        this.state.currentPrice * (1 + shock),
      ),
    );

    this.state = {
      ...this.state,
      currentPrice: newPrice,
      revision: this.state.revision + 1,
    };
  }

  setStockLevel(level: SupplierNodeConfig["stockLevel"]): void {
    this.state = {
      ...this.state,
      stockLevel: level,
      revision: this.state.revision + 1,
    };
  }
}

export class WeatherNode {
  private state: WeatherNodeState;

  constructor(config: WeatherNodeConfig) {
    this.state = {
      config,
      currentCondition: "clear",
      temperature: (config.temperatureRange[0] + config.temperatureRange[1]) / 2,
      humidity: 0.5,
      lastUpdatedAt: utcnowIso(),
      revision: 0,
    };
  }

  getState(): Readonly<WeatherNodeState> {
    return this.state;
  }

  update(currentTime: string, seed: string): void {
    const hash = createHash("sha256")
      .update(seed)
      .update(this.state.config.nodeId)
      .update(currentTime)
      .digest();

    const conditionRoll = hash.readUInt32BE(0) / 0xffffffff;
    const tempRoll = hash.readUInt32BE(4) / 0xffffffff;
    const humidityRoll = hash.readUInt32BE(8) / 0xffffffff;

    let condition: WeatherCondition;
    if (conditionRoll < this.state.config.stormProbability) {
      condition = "storm";
    } else if (conditionRoll < this.state.config.stormProbability * 3) {
      condition = "rain";
    } else if (conditionRoll < 0.3) {
      condition = "cloudy";
    } else {
      condition = "clear";
    }

    const [minTemp, maxTemp] = this.state.config.temperatureRange;
    const temperature = minTemp + tempRoll * (maxTemp - minTemp);
    const humidity = 0.2 + humidityRoll * 0.6;

    this.state = {
      ...this.state,
      currentCondition: condition,
      temperature,
      humidity,
      lastUpdatedAt: currentTime,
      revision: this.state.revision + 1,
    };
  }

  affectsEcologyGarden(): {
    irrigationModifier: number;
    energyModifier: number;
    growthModifier: number;
  } {
    const condition = this.state.currentCondition;
    const temp = this.state.temperature;

    let irrigationModifier = 1.0;
    let energyModifier = 1.0;
    let growthModifier = 1.0;

    switch (condition) {
      case "rain":
        irrigationModifier = 0.7;
        growthModifier = 1.1;
        break;
      case "storm":
        irrigationModifier = 0.5;
        growthModifier = 0.9;
        energyModifier = 1.2;
        break;
      case "clear":
        irrigationModifier = 1.2;
        growthModifier = 1.05;
        break;
    }

    if (temp < 10) {
      energyModifier *= 1.3;
      growthModifier *= 0.8;
    } else if (temp > 30) {
      energyModifier *= 1.2;
      irrigationModifier *= 1.3;
    }

    return { irrigationModifier, energyModifier, growthModifier };
  }
}

export function createDefaultServiceQueues(): ServiceQueue[] {
  return [
    new ServiceQueue({
      queueId: "instrument_queue",
      name: "Main Instrument Queue",
      capacity: 1,
      discipline: "reservation",
      openingWindows: [
        { dayOfWeek: 1, startHour: 8, endHour: 18 },
        { dayOfWeek: 2, startHour: 8, endHour: 18 },
        { dayOfWeek: 3, startHour: 8, endHour: 18 },
        { dayOfWeek: 4, startHour: 8, endHour: 18 },
        { dayOfWeek: 5, startHour: 8, endHour: 18 },
      ],
      baseServiceTimeMinutes: 30,
      serviceTimeVariance: 15,
      maintenanceFrequencyDays: 14,
      failureProbabilityPerDay: 0.02,
      priorityLevels: 3,
    }),
    new ServiceQueue({
      queueId: "technician_queue",
      name: "Maintenance Technician Queue",
      capacity: 2,
      discipline: "priority",
      openingWindows: [
        { dayOfWeek: 1, startHour: 9, endHour: 17 },
        { dayOfWeek: 2, startHour: 9, endHour: 17 },
        { dayOfWeek: 3, startHour: 9, endHour: 17 },
        { dayOfWeek: 4, startHour: 9, endHour: 17 },
        { dayOfWeek: 5, startHour: 9, endHour: 17 },
      ],
      baseServiceTimeMinutes: 120,
      serviceTimeVariance: 60,
      maintenanceFrequencyDays: 0,
      failureProbabilityPerDay: 0,
      priorityLevels: 4,
    }),
    new ServiceQueue({
      queueId: "approval_queue",
      name: "Director Approval Queue",
      capacity: 1,
      discipline: "fifo",
      openingWindows: [
        { dayOfWeek: 1, startHour: 10, endHour: 12 },
        { dayOfWeek: 1, startHour: 14, endHour: 16 },
        { dayOfWeek: 3, startHour: 10, endHour: 12 },
        { dayOfWeek: 3, startHour: 14, endHour: 16 },
        { dayOfWeek: 5, startHour: 10, endHour: 12 },
      ],
      baseServiceTimeMinutes: 45,
      serviceTimeVariance: 30,
      maintenanceFrequencyDays: 0,
      failureProbabilityPerDay: 0,
      priorityLevels: 2,
    }),
  ];
}

export function createDefaultBoundaryNodes(): {
  transport: TransportNode[];
  suppliers: SupplierNode[];
  weather: WeatherNode;
} {
  const transport = [
    new TransportNode({
      nodeId: "trimounts_metro",
      name: "Trimounts Metro",
      baseTravelTimeMinutes: 25,
      moneyCost: 5,
      openingWindows: [
        { dayOfWeek: 0, startHour: 6, endHour: 23 },
        { dayOfWeek: 1, startHour: 5, endHour: 24 },
        { dayOfWeek: 2, startHour: 5, endHour: 24 },
        { dayOfWeek: 3, startHour: 5, endHour: 24 },
        { dayOfWeek: 4, startHour: 5, endHour: 24 },
        { dayOfWeek: 5, startHour: 5, endHour: 24 },
        { dayOfWeek: 6, startHour: 6, endHour: 23 },
      ],
      capacity: 100,
      weatherSensitivity: 0.3,
    }),
    new TransportNode({
      nodeId: "rhine_shuttle",
      name: "Rhine Life Shuttle",
      baseTravelTimeMinutes: 15,
      moneyCost: 0,
      openingWindows: [
        { dayOfWeek: 1, startHour: 7, endHour: 20 },
        { dayOfWeek: 2, startHour: 7, endHour: 20 },
        { dayOfWeek: 3, startHour: 7, endHour: 20 },
        { dayOfWeek: 4, startHour: 7, endHour: 20 },
        { dayOfWeek: 5, startHour: 7, endHour: 20 },
      ],
      capacity: 20,
      weatherSensitivity: 0.5,
    }),
  ];

  const suppliers = [
    new SupplierNode({
      nodeId: "lab_supplies_vendor",
      name: "Laboratory Supplies Vendor",
      resourceTypeId: "cultivation_supplies",
      basePrice: 50,
      priceVolatility: 0.1,
      baseDeliveryDays: 3,
      deliveryVariance: 2,
      stockLevel: "normal",
      openingWindows: [
        { dayOfWeek: 1, startHour: 9, endHour: 17 },
        { dayOfWeek: 2, startHour: 9, endHour: 17 },
        { dayOfWeek: 3, startHour: 9, endHour: 17 },
        { dayOfWeek: 4, startHour: 9, endHour: 17 },
        { dayOfWeek: 5, startHour: 9, endHour: 17 },
      ],
    }),
    new SupplierNode({
      nodeId: "equipment_parts_vendor",
      name: "Equipment Parts Vendor",
      resourceTypeId: "pump_spare_parts",
      basePrice: 200,
      priceVolatility: 0.15,
      baseDeliveryDays: 5,
      deliveryVariance: 3,
      stockLevel: "normal",
      openingWindows: [
        { dayOfWeek: 1, startHour: 8, endHour: 18 },
        { dayOfWeek: 2, startHour: 8, endHour: 18 },
        { dayOfWeek: 3, startHour: 8, endHour: 18 },
        { dayOfWeek: 4, startHour: 8, endHour: 18 },
        { dayOfWeek: 5, startHour: 8, endHour: 18 },
      ],
    }),
  ];

  const weather = new WeatherNode({
    nodeId: "trimounts_weather",
    name: "Trimounts Weather Station",
    seasonalBias: 0.5,
    stormProbability: 0.05,
    temperatureRange: [5, 30],
  });

  return { transport, suppliers, weather };
}
