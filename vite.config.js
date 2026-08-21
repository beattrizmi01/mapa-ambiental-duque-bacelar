import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("leaflet") || id.includes("react-leaflet")) return "map-vendor";
          if (id.includes("@supabase")) return "data-vendor";
          if (id.includes("react")) return "react-vendor";
          return "vendor";
        },
      },
    },
  },
});
