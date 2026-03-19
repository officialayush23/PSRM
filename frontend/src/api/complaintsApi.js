import client from "./client";

export async function submitComplaint({ text, lat, lng, image }) {
  const formData = new FormData();
  formData.append("description", text);
  formData.append("original_language", "en");
  formData.append("lat", String(lat));
  formData.append("lng", String(lng));
  if (image) {
    formData.append("image", image);
  }

  const response = await client.post("/complaints/ingest", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  return response.data;
}

export async function fetchComplaintById(complaintId) {
  const response = await client.get(`/complaints/${complaintId}`);
  return response.data;
}
