import axios from "axios";

/** Resolve a customer's current email address from the trusted User Service. */
export async function getUser(userId) {
  const baseUrl = (
    process.env.USER_SERVICE_URL || "http://localhost:3001"
  ).replace(/\/$/, "");

  const response = await axios.get(`${baseUrl}/internal/users/${userId}`, {
    headers: {
      "x-internal-service-token": process.env.INTERNAL_SERVICE_TOKEN,
    },
    timeout: 10000,
  });

  return response.data.user;
}
