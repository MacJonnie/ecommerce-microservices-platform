
import axios from "axios";

// Create an Axios instance for communicating with the Paystack API.
const api = axios.create({
  // Use the configured Paystack URL or fall back to the official API.
  baseURL:
    process.env.PAYSTACK_BASE_URL || "https://api.paystack.co",

  // Abort requests that take longer than 15 seconds.
  timeout: 15000,

  // Authenticate requests using the Paystack secret key.
  headers: {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
  },
});

/**
 * Initialize a Paystack transaction.
 *
 * @param {Object} params - Transaction initialization details.
 * @param {string} params.email - Customer's email address.
 * @param {number} params.amount - Transaction amount in kobo.
 * @param {string} params.reference - Unique transaction reference.
 * @param {string} params.callbackUrl - URL Paystack redirects to after payment.
 * @param {Object} params.metadata - Additional transaction metadata.
 * @returns {Promise<Object>} Paystack transaction initialization data.
 */

export async function initialize({
  email,
  amount,
  reference,
  callbackUrl,
  metadata,
}) {
  // Send the transaction initialization request to Paystack.
  const { data } = await api.post("/transaction/initialize", {
    email,
    amount,
    currency: "NGN",
    reference,
    callback_url: callbackUrl,
    metadata,
  });

  // Ensure Paystack successfully initialized the transaction.
  if (!data.status) {
    throw new Error(data.message || "Paystack initialization failed");
  }

  // Return authorization URL, access code, and reference.
  return data.data;
}

/**
 * Verify a Paystack transaction.
 *
 * @param {string} reference - Transaction reference to verify.
 * @returns {Promise<Object>} Paystack transaction verification data.
 */

export async function verify(reference) {
  // URL-encode the reference to safely construct the API request.
  const { data } = await api.get(
    `/transaction/verify/${encodeURIComponent(reference)}`
  );

  // Ensure Paystack successfully processed the verification request.
  if (!data.status) {
    throw new Error(data.message || "Paystack verification failed");
  }

  // Return transaction details, including status and amount.
  return data.data;
}
