import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { applyAppearance, readAppearance } from "./appearance.ts";

// Before the first render, so the page never flashes the other theme.
applyAppearance(readAppearance());
const root = document.getElementById("root");
if (root !== null) createRoot(root).render(<App />);
