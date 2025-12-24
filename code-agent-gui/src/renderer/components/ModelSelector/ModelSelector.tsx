import { useState, useEffect } from 'react';
import './ModelSelector.css';

interface ModelInfo {
    id: string;
    type?: string;
    maxContextLength?: number;
    loaded?: boolean;
    architecture?: string;
    quantization?: string;
}

interface ModelSelectorProps {
    baseUrl: string;
    selectedModel: string;
    onModelChange: (model: string) => void;
    onContextLimitChange?: (limit: number) => void;
    disabled?: boolean;
}

export function ModelSelector({
    baseUrl,
    selectedModel,
    onModelChange,
    onContextLimitChange,
    disabled = false
}: ModelSelectorProps) {
    const [models, setModels] = useState<ModelInfo[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isOpen, setIsOpen] = useState(false);

    const fetchModels = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const modelList = await window.electronAPI.listModels(baseUrl);
            setModels(modelList);

            // If no model selected and there's a loaded one, auto-select it
            if (!selectedModel && modelList.length > 0) {
                const loadedModel = modelList.find(m => m.loaded);
                if (loadedModel) {
                    onModelChange(loadedModel.id);
                    if (loadedModel.maxContextLength && onContextLimitChange) {
                        onContextLimitChange(loadedModel.maxContextLength);
                    }
                }
            }
        } catch (e: any) {
            setError('Failed to load models');
        } finally {
            setIsLoading(false);
        }
    };

    // Fetch models on mount and when baseUrl changes
    useEffect(() => {
        if (baseUrl) {
            fetchModels();
        }
    }, [baseUrl]);

    // Fetch model info when selection changes
    useEffect(() => {
        const fetchInfo = async () => {
            if (selectedModel && baseUrl) {
                const info = await window.electronAPI.getModelInfo(baseUrl, selectedModel);
                if (info?.maxContextLength && onContextLimitChange) {
                    onContextLimitChange(info.maxContextLength);
                }
            }
        };
        fetchInfo();
    }, [selectedModel, baseUrl]);

    const handleSelect = (model: ModelInfo) => {
        onModelChange(model.id);
        if (model.maxContextLength && onContextLimitChange) {
            onContextLimitChange(model.maxContextLength);
        }
        setIsOpen(false);
    };

    const selectedModelInfo = models.find(m => m.id === selectedModel);

    return (
        <div className="model-selector">
            <div className="model-selector-header">
                <label>Model</label>
                <button
                    className="refresh-btn"
                    onClick={fetchModels}
                    disabled={isLoading}
                    title="Refresh model list"
                >
                    {isLoading ? '⟳' : '🔄'}
                </button>
            </div>

            <div className={`model-dropdown ${isOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`}>
                <button
                    className="model-dropdown-trigger"
                    onClick={() => !disabled && setIsOpen(!isOpen)}
                    disabled={disabled}
                >
                    <span className="model-name">
                        {selectedModel || 'Select a model...'}
                    </span>
                    {selectedModelInfo?.loaded && (
                        <span className="loaded-badge" title="Currently loaded">●</span>
                    )}
                    <span className="dropdown-arrow">{isOpen ? '▲' : '▼'}</span>
                </button>

                {isOpen && (
                    <div className="model-dropdown-menu">
                        {error && <div className="model-error">{error}</div>}
                        {models.length === 0 && !error && (
                            <div className="model-empty">No models found. Is LM Studio running?</div>
                        )}
                        {models.map(model => (
                            <div
                                key={model.id}
                                className={`model-option ${model.id === selectedModel ? 'selected' : ''}`}
                                onClick={() => handleSelect(model)}
                            >
                                <div className="model-option-main">
                                    <span className="model-option-name">{model.id}</span>
                                    {model.loaded && (
                                        <span className="loaded-badge" title="Currently loaded">●</span>
                                    )}
                                </div>
                                {model.maxContextLength && (
                                    <span className="model-context">
                                        {(model.maxContextLength / 1024).toFixed(0)}K ctx
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {selectedModelInfo?.maxContextLength && (
                <div className="model-info">
                    Context: {(selectedModelInfo.maxContextLength / 1024).toFixed(0)}K tokens
                </div>
            )}
        </div>
    );
}
