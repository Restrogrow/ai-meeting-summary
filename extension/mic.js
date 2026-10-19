// Offscreen recorder can't show a permission prompt, so it's asked for once here
const msg = document.getElementById("msg");
const again = document.getElementById("again");

async function ask() {
  again.hidden = true;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    msg.textContent = "✓ Microphone allowed. You can close this tab.";
    setTimeout(() => window.close(), 1500);
  } catch {
    msg.textContent = "Microphone was blocked. Click the 🔒 icon in the address bar → allow Microphone, then try again.";
    again.hidden = false;
  }
}

again.onclick = ask;
ask();
