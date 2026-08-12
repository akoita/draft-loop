import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function App() {
  return (
    <main>
      <h1>Draft Loop</h1>
      <p>The desktop shell will host the local author–critic workspace.</p>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Draft Loop root element is missing.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
