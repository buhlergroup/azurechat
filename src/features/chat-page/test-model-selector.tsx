"use client";
import { useState, useEffect } from "react";
import { ChatModel, MODEL_CONFIGS, getAvailableModels, ModelConfig } from "./chat-services/models";
import { ModelSelector } from "./chat-header/model-selector";

export const TestModelSelector = () => {
  const [availableModels, setAvailableModels] = useState<Record<ChatModel, ModelConfig>>(MODEL_CONFIGS);
  const [loading, setLoading] = useState(true);
  const [selectedModel, setSelectedModel] = useState<ChatModel>("gpt-4.1");

  useEffect(() => {
    const fetchAvailableModels = async () => {
      try {
        const models = await getAvailableModels();
        setAvailableModels(models);
        
        // Set default model to first available model
        const availableModelIds = Object.keys(models) as ChatModel[];
        if (availableModelIds.length > 0) {
          setSelectedModel(availableModelIds[0]);
        }
      } catch (error) {
        console.error('Error fetching available models:', error);
        // Fallback to all models if API fails
        setAvailableModels(MODEL_CONFIGS);
      } finally {
        setLoading(false);
      }
    };

    fetchAvailableModels();
  }, []);

  const availableModelIds = Object.keys(availableModels) as ChatModel[];

  if (loading) {
    return (
      <div className="p-4">
        <h2 className="text-xl font-bold">Model Selector Test</h2>
        <p>Loading models...</p>
      </div>
    );
  }

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
          <p><strong>Model:</strong> {MODEL_CONFIGS[selectedModel]?.name || "Unknown"}</p>
          <p><strong>Description:</strong> {MODEL_CONFIGS[selectedModel]?.description || "No description"}</p>
          <p><strong>Supports Reasoning:</strong> {MODEL_CONFIGS[selectedModel]?.supportsReasoning ? "Yes" : "No"}</p>
          <p><strong>Available:</strong> {availableModels[selectedModel] ? "Yes" : "No"}</p>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Available Models ({availableModelIds.length}):</h3>
        {availableModelIds.length === 0 ? (
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded">
            <p className="text-yellow-800">No models are currently available. Check your environment variables.</p>
          </div>
        ) : (
          Object.values(availableModels).map((model) => (
            <div key={model.id} className="p-2 border rounded bg-green-50">
              <p><strong>{model.name}</strong> <span className="text-xs bg-green-200 px-1 rounded">Available</span></p>
              <p className="text-sm text-gray-600">{model.description}</p>
              <p className="text-xs text-gray-500">Deployment: {model.deploymentName}</p>
            </div>
          ))
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-lg font-semibold">All Configured Models ({Object.keys(MODEL_CONFIGS).length}):</h3>
        {Object.values(MODEL_CONFIGS).map((model) => {
          const isAvailable = !!availableModels[model.id];
          return (
            <div key={model.id} className={`p-2 border rounded ${isAvailable ? 'bg-green-50' : 'bg-red-50'}`}>
              <p><strong>{model.name}</strong> 
                <span className={`text-xs px-1 rounded ml-2 ${isAvailable ? 'bg-green-200' : 'bg-red-200'}`}>
                  {isAvailable ? 'Available' : 'Unavailable'}
                </span>
              </p>
              <p className="text-sm text-gray-600">{model.description}</p>
              <p className="text-xs text-gray-500">
                Deployment: {model.deploymentName || "Not configured"}
                {!isAvailable && " (Environment variable not set or empty)"}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
};
