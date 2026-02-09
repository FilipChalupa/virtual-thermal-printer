const printerOutput = document.getElementById("printer-output");
const socket = new WebSocket(`ws://${location.host}/stream`);

socket.onopen = () => {
  console.log("WebSocket connected.");
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
  } catch (error) {
    const p = document.createElement("p");
    p.textContent = message;
    printerOutput.appendChild(p);
    printerOutput.scrollTop = printerOutput.scrollHeight;
  }
};

socket.onclose = () => {
  console.log("WebSocket disconnected.");
};

socket.onerror = (error) => {
  console.error("WebSocket error:", error);
};