"use client";
import { useState } from "react";
import { ChatModel, MODEL_CONFIGS } from "./chat-services/models";
import { ModelSelector } from "./chat-header/model-selector";

export const TestModelSelector = () => {
  const [selectedModel, setSelectedModel] = useState<ChatModel>("gpt-4.1");

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xl font-bold">Model Selector Test</h2>
      
      <div className="space-y-2">
        <label className="text-sm font-medium">Selected Model:</label>
        <ModelSelector
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
        />
      </div>

      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Current Selection:</h3>
        <div className="p-3 bg-gray-100 rounded">
          <p><strong>Model:</strong> {MODEL_CONFIGS[selectedModel].name}</p>
          <p><strong>Description:</strong> {MODEL_CONFIGS[selectedModel].description}</p>
          <p><strong>Supports Reasoning:</strong> {MODEL_CONFIGS[selectedModel].supportsReasoning ? "Yes" : "No"}</p>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Available Models:</h3>
        {Object.values(MODEL_CONFIGS).map((model) => (
          <div key={model.id} className="p-2 border rounded">
            <p><strong>{model.name}</strong></p>
            <p className="text-sm text-gray-600">{model.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
