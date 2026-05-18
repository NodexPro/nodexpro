import type { IncomeWorkspaceCard } from '../../api/income';

type Props = {
  cards: IncomeWorkspaceCard[];
  onCardAction: (card: IncomeWorkspaceCard, action: string) => void;
};

export function IncomeCardsGrid({ cards, onCardAction }: Props) {
  return (
    <div className="nx-income-cards-grid" role="list">
      {cards.map((card) => {
        const primaryAction = card.allowed_actions[0] ?? null;
        const disabled = card.disabled === true;
        return (
          <button
            key={card.key}
            type="button"
            className="nx-income-card"
            role="listitem"
            disabled={disabled || card.allowed_actions.length === 0}
            title={disabled ? (card.disabled_reason ?? undefined) : undefined}
            onClick={() => {
              if (primaryAction) onCardAction(card, primaryAction);
            }}
          >
            <span className="nx-income-card__label">{card.label}</span>
            {card.count != null ? <span className="nx-income-card__count">{card.count}</span> : null}
            {disabled && card.disabled_reason ? (
              <span className="nx-income-card__hint">{card.disabled_reason}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
