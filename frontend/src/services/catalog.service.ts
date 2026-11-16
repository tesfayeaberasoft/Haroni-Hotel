import type { HotelService, PriceRequest, ServiceCategory } from "@/types";
import { USE_DEMO_BACKEND } from "./config";
import { api, ApiError } from "./http";
import { mapPhpPriceRequest, mapPhpService, phpRows, phpText } from "./php-mappers";

export interface ServiceInput {
  name: string;
  category: ServiceCategory;
  price: number;
  available: boolean;
  priceReason?: string | undefined;
}

async function categoryId(category: ServiceCategory): Promise<number> {
  const response = await api.get<{ categories: { id: number; name: string }[] }>("/service-categories");
  const value = response.categories.find((item) => item.name.toLowerCase() === category);
  if (!value) throw new ApiError(`No active service category is configured for "${category}".`, 422);
  return value.id;
}

export const catalogService = {
  list: async () => {
    if (USE_DEMO_BACKEND) return api.get<HotelService[]>("/services");
    const response = await api.get<{ services: unknown[] }>("/service-catalog");
    return phpRows(response.services).map(mapPhpService);
  },
  create: async (input: ServiceInput) => {
    if (USE_DEMO_BACKEND) return api.post<HotelService>("/services", input);
    const response = await api.post<{ id: number; price_request_id: number }>("/service-catalog", {
      category_id: await categoryId(input.category),
      name: input.name,
      price: input.price.toFixed(2),
    });
    return {
      id: String(response.id),
      name: input.name,
      category: input.category,
      price: 0,
      available: false,
      proposedPrice: input.price,
      priceHistory: [],
    } satisfies HotelService;
  },
  update: async (id: string, input: Partial<ServiceInput>) => {
    if (USE_DEMO_BACKEND) return api.put<HotelService>(`/services/${id}`, input);
    const operations: Promise<unknown>[] = [];
    if (input.name !== undefined || input.category !== undefined) {
      operations.push(api.post(`/service-catalog/${id}/profile`, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.category !== undefined ? { category_id: await categoryId(input.category) } : {}),
      }));
    }
    if (input.price !== undefined) {
      if (!input.priceReason?.trim()) throw new ApiError("A reason is required to request a catalog price change.", 422);
      operations.push(api.post(`/service-catalog/${id}/price-requests`, {
        proposed_price: input.price.toFixed(2),
        reason: input.priceReason.trim(),
      }));
    }
    if (input.available !== undefined) {
      operations.push(api.post(`/service-catalog/${id}/status`, { active: input.available }));
    }
    await Promise.all(operations);
    const response = await api.get<{ services: unknown[] }>("/service-catalog");
    const service = phpRows(response.services).map(mapPhpService).find((item) => item.id === id);
    if (!service) throw new ApiError("Updated service was not returned by the server.", 502);
    return service;
  },
  priceRequests: async () => {
    if (USE_DEMO_BACKEND) return api.get<PriceRequest[]>("/price-requests");
    const response = await api.get<{ requests: unknown[] }>("/service-price-requests");
    return phpRows(response.requests).map(mapPhpPriceRequest);
  },
  approvePrice: async (id: string) => {
    if (USE_DEMO_BACKEND) return api.post<PriceRequest>(`/price-requests/${id}/approve`);
    const request = (await catalogService.priceRequests()).find((item) => item.id === id);
    if (!request) throw new ApiError("Price request is no longer awaiting review.", 409);
    const requestId = id.replace(/^(catalog|transaction)-/, "");
    await api.post(
      request.kind === "transaction"
        ? `/transaction-price-requests/${requestId}/approve`
        : `/service-price-requests/${requestId}/approve`,
    );
    return { ...request, status: "approved" as const };
  },
  rejectPrice: async (id: string) => {
    if (USE_DEMO_BACKEND) return api.post<PriceRequest>(`/price-requests/${id}/reject`);
    const request = (await catalogService.priceRequests()).find((item) => item.id === id);
    if (!request) throw new ApiError("Price request is no longer awaiting review.", 409);
    const requestId = id.replace(/^(catalog|transaction)-/, "");
    await api.post(
      request.kind === "transaction"
        ? `/transaction-price-requests/${requestId}/reject`
        : `/service-price-requests/${requestId}/reject`,
      { reason: "Rejected by the Finance Manager." },
    );
    return { ...request, status: "rejected" as const };
  },
  priceHistory: async (id: string) => {
    if (USE_DEMO_BACKEND) {
      const services = await api.get<HotelService[]>("/services");
      return services.find((service) => service.id === id)?.priceHistory ?? [];
    }
    const response = await api.get<{ price_history: unknown[] }>(`/service-catalog/${id}/price-history`);
    return phpRows(response.price_history).map((row) => ({
      price: Number(row.new_price),
      effectiveFrom: phpText(row.approved_at),
      approvedBy: phpText(row.approved_by),
    }));
  },
};
