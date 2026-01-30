import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_AUTH0_DOMAIN": JSON.stringify(process.env.AUTH0_DOMAIN),
    "import.meta.env.VITE_AUTH0_CLIENT_ID": JSON.stringify(process.env.AUTH0_CLIENT_ID),
    "import.meta.env.VITE_AUTH0_AUDIENCE": JSON.stringify(process.env.AUTH0_AUDIENCE),
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8888",
        changeOrigin: true,
      },
    },
  },
});
