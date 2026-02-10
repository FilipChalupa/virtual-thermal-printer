const printerOutput = document.getElementById("printer-output");
let socket;
let reconnectInterval = 1000; // Initial reconnect attempt after 1 second

function connectWebSocket() {
  socket = new WebSocket(`ws://${location.host}/stream`);

  socket.onopen = () => {
    console.log("WebSocket connected.");
    reconnectInterval = 1000; // Reset reconnect interval on successful connection
    // Clear existing content on successful reconnect
    while (printerOutput.firstChild) {
      printerOutput.removeChild(printerOutput.firstChild);
    }
  };

  socket.onmessage = (event) => {
    const message = event.data;
    try {
      const data = JSON.parse(message);
      if (data.type === "image") {
        const canvas = document.createElement("canvas");
        canvas.width = data.width;
        canvas.height = data.height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const imageData = ctx.createImageData(data.width, data.height);
          for (let i = 0; i < data.data.length; i++) {
            const pixel = data.data[i];
            imageData.data[i * 4] = pixel;
            imageData.data[i * 4 + 1] = pixel;
            imageData.data[i * 4 + 2] = pixel;
            imageData.data[i * 4 + 3] = 255;
          }
          ctx.putImageData(imageData, 0, 0);
        }
        printerOutput.appendChild(canvas);
        printerOutput.scrollTop = printerOutput.scrollHeight;
      }
    } catch (_error) {
      message.split('\n').forEach(line => {
        const div = document.createElement("div");
        div.textContent = line;
        printerOutput.appendChild(div);
      });
      printerOutput.scrollTop = printerOutput.scrollHeight;
    }
  };

  socket.onclose = () => {
    console.log(`WebSocket disconnected. Attempting to reconnect in ${reconnectInterval / 1000} seconds...`);
    setTimeout(connectWebSocket, reconnectInterval);
    reconnectInterval = Math.min(reconnectInterval * 2, 30000); // Exponential backoff, max 30 seconds
  };

  socket.onerror = (error) => {
    console.error("WebSocket error:", error);
    socket.close(); // Close the socket to trigger onclose and reconnect logic
  };
}

// Initial connection
connectWebSocket();
