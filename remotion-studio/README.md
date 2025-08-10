Remotion Studio (Local Dev)
===========================

This is a minimal Remotion project so you can run Remotion Studio locally and preview compositions.

Prerequisites
- Node.js 18+

Install & Run
- cd remotion-studio
- npm install
- npm run dev
- A browser window opens with Remotion Studio. Select the MyComp composition to preview.

Render
- Video: npm run render (outputs to out/video.mp4)
- Still: npm run still (outputs to out/still.png)

Project Structure
- src/index.ts: Entry point (registerRoot)
- src/Root.tsx: Registers the composition
- src/MyComp.tsx: Example composition with an in-video progress bar

Using Generated Projects
- You can copy files returned from the generator (src/index.ts, src/Root.tsx, src/MyComp.tsx, etc.) into this src/ folder to preview them in Studio.

