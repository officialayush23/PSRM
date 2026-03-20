import client from "./client";

export async function submitComplaint({ text, lat, lng, image, language = "en" }) {
  const formData = new FormData();
  formData.append("description", text);
  formData.append("original_language", language);
  formData.append("lat", String(lat));
  formData.append("lng", String(lng));
  if (image) formData.append("image", image);

  const response = await client.post("/complaints/ingest", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}

export async function fetchComplaintById(complaintId) {
  const { data } = await client.get(`/complaints/${complaintId}`);
  return data;
}

export async function fetchMyComplaints({ limit = 20, offset = 0, status } = {}) {
  const params = { limit, offset };
  if (status) params.status = status;
  const { data } = await client.get("/complaints", { params });
  return data; // { total, limit, offset, items }
}

export async function fetchComplaintHistory(complaintId) {
  const { data } = await client.get(`/complaints/${complaintId}/history`);
  return data;
}

// My own complaint locations — used only for "My Complaints" map if needed
export async function fetchMapPins() {
  const { data } = await client.get("/complaints/map-pins");
  return data;
}

// ALL complaints within radius_meters of (lat, lng) — used by Dashboard map
export async function fetchNearbyComplaints(lat, lng, radiusMeters = 4000) {
  const { data } = await client.get("/complaints/nearby", {
    params: { lat, lng, radius_meters: radiusMeters },
  });
  return data;
}

export async function fetchMyStats() {
  const { data } = await client.get("/stats/me");
  return data;
}