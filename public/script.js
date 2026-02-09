const printerOutput = document.getElementById("printer-output");
const socket = new WebSocket(`ws://${location.host}/stream`);

socket.onopen = () => {
  console.log("WebSocket connected.");
};

socket.onmessage = (event) => {
  const message = event.data;
  const p = document.createElement("p");
  p.textContent = message;
  printerOutput.appendChild(p);
  printerOutput.scrollTop = printerOutput.scrollHeight; // Auto-scroll to bottom
};

socket.onclose = () => {
  console.log("WebSocket disconnected.");
};

socket.onerror = (error) => {
  console.error("WebSocket error:", error);
};