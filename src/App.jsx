import { useState } from "react";
import ArrayDiffChecker from "./ArrayDiffChecker";
import ObjectDiffChecker from "./ObjectDiffChecker";
import "./App.css";

export default function App() {
  const [checker, setCecker] = useState("array");

  return (
    <>
      <button onClick={() => setCecker("array")}>Array</button>
      <button onClick={() => setCecker("object")}>Object</button>

      {checker === "array" ? <ArrayDiffChecker /> : <ObjectDiffChecker />}
    </>
  );
}
