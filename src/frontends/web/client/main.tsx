import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { applyAppearance, readAppearance } from "./appearance.ts";
import { startCues } from "./cues.ts";

// Before the first render, so the page never flashes the other theme.
applyAppearance(readAppearance());
startCues();
const root = document.getElementById("root");
if (root !== null) createRoot(root).render(<App />);
