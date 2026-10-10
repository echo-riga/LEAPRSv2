type GuideScreenshot = { src: string; alt: string; width: number; height: number };
type GuideStep = { instruction: string; screenshot?: GuideScreenshot };
type AiAppGuide = { id: string; label: string; steps: GuideStep[] };

// Add only actual captured screenshots. See public/mcp-guides/README.md.
export const AI_APP_GUIDES: AiAppGuide[] = [
  {
    id: 'claude', label: 'Claude', steps: [
      { instruction: 'Click Customize.', screenshot: {
        src: '/mcp-guides/msedge_nar8S2nYPz.png', alt: 'Claude sidebar with the pointer on Customize.', width: 500, height: 400,
      } },
      { instruction: 'Click Connectors.', screenshot: {
        src: '/mcp-guides/msedge_ljdr9sIrmV.png', alt: 'Customize page with the pointer on Connectors.', width: 500, height: 400,
      } },
      { instruction: 'Open Add → Add custom connector.', screenshot: {
        src: '/mcp-guides/msedge_KZ4Gj7NVgj.png', alt: 'Add menu with the pointer on Add custom connector.', width: 500, height: 400,
      } },
      { instruction: 'Enter LEAPRS, paste the server URL, then click Continue.', screenshot: {
        src: '/mcp-guides/msedge_uU17SijQbQ.png', alt: 'LEAPRS name and server URL entered, with the pointer on Continue.', width: 500, height: 400,
      } },
      { instruction: 'Select Sign in now and Register automatically.', screenshot: {
        src: '/mcp-guides/msedge_6nJr5kXUBd.png', alt: 'Sign in now and Register automatically selected.', width: 500, height: 400,
      } },
      { instruction: 'Scroll down and click Add.', screenshot: {
        src: '/mcp-guides/msedge_jZUP7536ed.png', alt: 'Bottom of the connector dialog with the pointer on Add.', width: 500, height: 400,
      } },
      { instruction: 'Click Connect.', screenshot: {
        src: '/mcp-guides/msedge_9Lm3QEmiKI.png', alt: 'LEAPRS connector with the pointer on Connect.', width: 500, height: 400,
      } },
      { instruction: 'Sign in to LEAPRS and click Allow access.', screenshot: {
        src: '/mcp-guides/msedge_SbIzoZFlpt.png', alt: 'LEAPRS approval screen with the pointer on Allow access.', width: 500, height: 400,
      } },
      { instruction: 'Open + → Connectors and turn on LEAPRS. Send: “Use LEAPRS to show my requests and their current status.”', screenshot: {
        src: '/mcp-guides/msedge_mPX4znAdbs.png', alt: 'Claude chat with LEAPRS enabled and a message asking to show requests and their current status.', width: 500, height: 400,
      } },
    ],
  },
  {
    id: 'chatgpt', label: 'ChatGPT', steps: [
      { instruction: 'Click Plugins.', screenshot: {
        src: '/mcp-guides/msedge_hL1hpMD70l.png', alt: 'ChatGPT sidebar with the pointer on Plugins.', width: 500, height: 400,
      } },
      { instruction: 'Open Add → Add custom MCP server.', screenshot: {
        src: '/mcp-guides/msedge_E4tKMNuDAG.png', alt: 'Add menu with the pointer on Add custom MCP server.', width: 500, height: 400,
      } },
      { instruction: 'Enter LEAPRS, paste the server URL, and choose OAuth. Open Advanced OAuth settings.', screenshot: {
        src: '/mcp-guides/msedge_AGUYBZX0aa.png', alt: 'LEAPRS name and server URL entered with OAuth selected and Advanced OAuth settings below.', width: 500, height: 400,
      } },
      { instruction: 'Select Dynamic Client Registration (DCR), then return to the setup screen.', screenshot: {
        src: '/mcp-guides/msedge_77eADp5dLL.png', alt: 'OAuth advanced settings with Dynamic Client Registration (DCR) selected.', width: 500, height: 400,
      } },
      { instruction: 'Check I understand and want to continue, then click Create as a plugin.', screenshot: {
        src: '/mcp-guides/msedge_Opx7kpU7Vm.png', alt: 'Acknowledgment checked with the pointer on Create as a plugin.', width: 500, height: 400,
      } },
      { instruction: 'Click Continue to LEAPRS.', screenshot: {
        src: '/mcp-guides/msedge_3aZ5ntIFf5.png', alt: 'Connect LEAPRS dialog with the pointer on Continue to LEAPRS.', width: 500, height: 400,
      } },
      { instruction: 'Sign in to LEAPRS and click Allow access.', screenshot: {
        src: '/mcp-guides/msedge_C5Ydm6f4qK.png', alt: 'LEAPRS approval screen for ChatGPT with the pointer on Allow access.', width: 500, height: 400,
      } },
      { instruction: 'In a chat, select LEAPRS from + or @. Send: “Use LEAPRS to show my requests and their current status.”', screenshot: {
        src: '/mcp-guides/msedge_ZTRa8CktJE.png', alt: 'ChatGPT message with LEAPRS selected and a request to show requests and their current status.', width: 500, height: 400,
      } },
    ],
  },
];
