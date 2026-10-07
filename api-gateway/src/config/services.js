import "dotenv/config";

const requiredEnvironmentVariables = [
  "USER_SERVICE_URL",
  "CATALOG_SERVICE_URL",
];

for (const variable of requiredEnvironmentVariables) {
  if (!process.env[variable]) {
    throw new Error(
      `${variable} is not configured in the environment.`
    );
  }
}

const services = {
  userService: process.env.USER_SERVICE_URL,
  catalogService: process.env.CATALOG_SERVICE_URL,
};

export default services;