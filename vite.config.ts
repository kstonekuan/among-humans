import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [tailwindcss()],

	// Build configuration
	build: {
		outDir: "dist/client",
		emptyOutDir: true,
		sourcemap: true,
	},

	// Development server configuration
	server: {
		port: 5173,
		// Proxy Socket.io and API requests to Express backend
		proxy: {
			"/socket.io": {
				target: "http://localhost:3000",
				ws: true,
				changeOrigin: true,
				secure: false,
			},
			"/api": {
				target: "http://localhost:3000",
				changeOrigin: true,
				secure: false,
			},
		},
	},

	// Optimize dependencies
	optimizeDeps: {
		include: ["socket.io-client"],
	},
});
