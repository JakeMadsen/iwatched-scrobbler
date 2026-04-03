import { useState } from "react";

interface AccountMenuProps {
  connected: boolean;
  displayName: string;
  handle: string;
  onSignIn: () => void;
  onLogOut: () => void;
}

export function AccountMenu({
  connected,
  displayName,
  handle,
  onSignIn,
  onLogOut
}: AccountMenuProps) {
  const [open, setOpen] = useState(false);

  const handlePrimaryAction = () => {
    if (connected) {
      onLogOut();
    } else {
      onSignIn();
    }
    setOpen(false);
  };

  return (
    <div className="account-menu">
      <button
        type="button"
        className="hero-card__settings"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open account menu"
        onClick={() => setOpen((current) => !current)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path
            d="M10.4 2.9h3.2l.5 2a7.3 7.3 0 0 1 1.7.7l1.8-1 2.2 2.2-1 1.8c.3.5.6 1.1.7 1.7l2 .5v3.2l-2 .5a7.3 7.3 0 0 1-.7 1.7l1 1.8-2.2 2.2-1.8-1a7.3 7.3 0 0 1-1.7.7l-.5 2h-3.2l-.5-2a7.3 7.3 0 0 1-1.7-.7l-1.8 1-2.2-2.2 1-1.8a7.3 7.3 0 0 1-.7-1.7l-2-.5v-3.2l2-.5c.1-.6.4-1.2.7-1.7l-1-1.8 2.2-2.2 1.8 1a7.3 7.3 0 0 1 1.7-.7l.5-2Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="12" r="3.2" />
        </svg>
      </button>

      {open && (
        <div className="account-menu__popover" role="menu">
          <div className="account-menu__summary">
            <span className="account-menu__label">Account</span>
            <strong>{displayName}</strong>
            <span>{handle}</span>
          </div>

          <div className="account-menu__item account-menu__item--static" role="presentation">
            <span>State</span>
            <strong>{connected ? "Mock connected" : "Signed out"}</strong>
          </div>

          <button
            type="button"
            className="account-menu__item"
            role="menuitem"
            onClick={handlePrimaryAction}
          >
            {connected ? "Log out (mock)" : "Sign in (mock)"}
          </button>

          <button
            type="button"
            className="account-menu__item account-menu__item--muted"
            role="menuitem"
          >
            Account info
          </button>
        </div>
      )}
    </div>
  );
}
