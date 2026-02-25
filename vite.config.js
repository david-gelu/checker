import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(),tailwindcss()], 
  server: {
    host: true,
    allowedHosts: ["pzrl8w-5173.csb.app","pzrl8w-4173.csb.app"]
  }
});
