// UI helper utilities for client-side status messages

export function updateStatusMessage(message: string): void {
	const statusMessage = document.getElementById("status-message");
	if (statusMessage) {
		statusMessage.textContent = message;
	}
}

export function showErrorMessage(message: string): void {
	const statusMessage = document.getElementById("status-message");
	if (statusMessage) {
		statusMessage.textContent = message;
		statusMessage.classList.remove("bg-blue-500");
		statusMessage.classList.add("bg-red-500");

		// Reset to normal color after a few seconds
		setTimeout(() => {
			statusMessage.classList.remove("bg-red-500");
			statusMessage.classList.add("bg-blue-500");
		}, 3000);
	}
}

export function showSuccessMessage(message: string): void {
	const statusMessage = document.getElementById("status-message");
	if (statusMessage) {
		statusMessage.textContent = message;
		statusMessage.classList.remove("bg-red-500");
		statusMessage.classList.add("bg-blue-500");
	}
}

export function showElement(elementId: string): void {
	const element = document.getElementById(elementId);
	if (element) {
		element.classList.remove("hidden");
	}
}
