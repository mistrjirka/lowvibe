
import './PlanPanel.css';

interface Todo {
    title: string;
    details: string;
    status: 'pending' | 'done';
    acceptanceCriteria: string[];
}

interface Plan {
    restatement: string;
    todos: Todo[];
}

interface PlanPanelProps {
    plan: Plan | null;
    isExpanded: boolean;
    onToggle: () => void;
}

export function PlanPanel({ plan, isExpanded, onToggle }: PlanPanelProps) {
    if (!plan) return null;

    const completedCount = plan.todos.filter(t => t.status === 'done').length;
    const totalCount = plan.todos.length;

    return (
        <div className={`plan-panel ${isExpanded ? 'expanded' : 'collapsed'}`}>
            <div className="plan-header" onClick={onToggle}>
                <div className="plan-header-left">
                    <span className="plan-icon">📋</span>
                    <span className="plan-title">Plan</span>
                    <span className="plan-progress">
                        {completedCount}/{totalCount} tasks
                    </span>
                </div>
                <span className="plan-chevron">{isExpanded ? '▼' : '▶'}</span>
            </div>

            {isExpanded && (
                <div className="plan-content">
                    <div className="plan-restatement">
                        <strong>Goal:</strong> {plan.restatement}
                    </div>

                    <ul className="plan-todos">
                        {plan.todos.map((todo, i) => (
                            <li key={i} className={`todo-item todo-${todo.status}`}>
                                <div className="todo-header">
                                    <span className="todo-checkbox">
                                        {todo.status === 'done' ? '✓' : '○'}
                                    </span>
                                    <span className="todo-title">{todo.title}</span>
                                </div>
                                <p className="todo-details">{todo.details}</p>
                                {todo.acceptanceCriteria.length > 0 && (
                                    <ul className="todo-criteria">
                                        {todo.acceptanceCriteria.map((c, j) => (
                                            <li key={j}>{c}</li>
                                        ))}
                                    </ul>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
