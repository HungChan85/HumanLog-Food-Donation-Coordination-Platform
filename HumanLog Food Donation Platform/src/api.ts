export type Role = "Donor" | "Requester" | "Coordinator";
export type User = { id: string; email: string; name: string; role: Role };
export type Warehouse = {
  name: string;
  address: string;
  lat: number;
  lon: number;
  distanceKm?: number;
};
export type LocationPreview = {
  latitude: number;
  longitude: number;
  warehouse: Warehouse;
  warehouses: Warehouse[];
  geographicDistanceKm: number;
  route: {
    distanceKm: number;
    durationMinutes: number;
    points: [number, number][];
  } | null;
};
export type FoodQuantities = {
  dry: number;
  fresh: number;
  canned: number;
  dairy: number;
  condiments: number;
};
type RecordBase = {
  id: string;
  ownerId: string | null;
  legacy?: { sourceKey: string; originalExpiry: string; needsUnitReview: boolean };
  warehouse: string;
  warehouseAddress: string;
  status: "Pending" | "Processed" | "Picked Up";
  submitted: string;
  updatedAt: string;
  address: string;
  latitude: number;
  longitude: number;
  location: LocationPreview;
  flowStatus: string;
};
export type Donation = RecordBase & {
  donor: string;
  category: string;
  quantity: string;
  quantityValue: number;
  unit: string;
  weight: string;
  weightValue: number;
  expiry: string;
  shelf: string;
  storage: string;
};
export type RequestRecord = RecordBase & {
  requester: string;
  categories: string;
  quantities: string;
  foodQuantities: FoodQuantities;
};
export type DonationInput = Pick<
  Donation,
  | "donor"
  | "category"
  | "quantityValue"
  | "unit"
  | "weightValue"
  | "expiry"
  | "shelf"
  | "storage"
  | "address"
> & {
  latitude?: number;
  longitude?: number;
};
export type RequestInput = Pick<RequestRecord, "requester" | "foodQuantities" | "address"> & {
  latitude?: number;
  longitude?: number;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, method = "GET", data?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: data === undefined ? {} : { "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  } catch {
    throw new ApiError("Cannot connect to the server. Please try again.", 503);
  }
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !path.includes("/api/auth/"))
      window.dispatchEvent(new Event("humanlog-session-expired"));
    throw new ApiError(
      result?.error || "The service is unavailable. Please try again.",
      response.status,
    );
  }
  if (result === null) throw new ApiError("The server returned an invalid response.", 503);
  return result as T;
}

export const foodCategories = [
  "Dry Food",
  "Fresh Food",
  "Canned Food",
  "Dairy & Chilled Food",
  "Condiments",
];
export const quantityFields = [
  ["dry", "Dry Food", "kg"],
  ["fresh", "Fresh Food", "kg"],
  ["canned", "Canned Food", "units"],
  ["dairy", "Dairy & Chilled Food", "units"],
  ["condiments", "Condiments", "units"],
] as const;
export const displayDate = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
