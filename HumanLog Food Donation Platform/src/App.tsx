import {
  cloneElement,
  isValidElement,
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactElement } from "react";

import { api, ApiError, displayDate, foodCategories, quantityFields } from "./api";

import type {
  Donation,
  DonationInput,
  FoodQuantities,
  LocationPreview,
  RequestInput,
  RequestRecord,
  Role,
  User,
  Warehouse,
} from "./api";

import LiveMap from "./LiveMap";

type Page =
  | "welcome"
  | "overview"
  | "donations"
  | "requests"
  | "warehouses"
  | "new-donation"
  | "my-donations"
  | "donation-confirmation"
  | "donation-tracking"
  | "new-request"
  | "my-requests"
  | "request-confirmation"
  | "request-tracking";

type FoodRecord = Donation | RequestRecord;

const home = (role: Role): Page =>
  role === "Donor" ? "my-donations" : role === "Requester" ? "my-requests" : "overview";

const allowed: Record<Role, Page[]> = {
  Donor: ["new-donation", "my-donations", "donation-confirmation", "donation-tracking"],

  Requester: ["new-request", "my-requests", "request-confirmation", "request-tracking"],

  Coordinator: ["overview", "donations", "requests", "warehouses"],
};

const message = (error: unknown) => (error instanceof Error ? error.message : "Please try again.");

const recordName = (record: FoodRecord) => ("donor" in record ? record.donor : record.requester);

const noQuantities: FoodQuantities = {
  dry: 0,
  fresh: 0,
  canned: 0,
  dairy: 0,
  condiments: 0,
};

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </>
    ),

    box: (
      <>
        <path d="m21 8-9 5-9-5" />
        <path d="M3 8l9-5 9 5v8l-9 5-9-5Z" />
        <path d="M12 13v8" />
      </>
    ),

    clipboard: (
      <>
        <path d="M9 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3" />
        <rect x="9" y="3" width="6" height="4" rx="1" />
        <path d="M8 12h8M8 16h5" />
      </>
    ),

    map: (
      <>
        <path d="m3 6 5-3 8 3 5-3v15l-5 3-8-3-5 3Z" />
        <path d="M8 3v15M16 6v15" />
      </>
    ),

    plus: <path d="M12 5v14M5 12h14" />,

    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),

    chevron: <path d="m9 18 6-6-6-6" />,

    down: <path d="m6 9 6 6 6-6" />,

    menu: (
      <>
        <path d="M4 7h16M4 12h16M4 17h16" />
      </>
    ),

    close: (
      <>
        <path d="m6 6 12 12M18 6 6 18" />
      </>
    ),

    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
      </>
    ),

    arrow: (
      <>
        <path d="M5 12h14M13 6l6 6-6 6" />
      </>
    ),

    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),

    location: (
      <>
        <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),

    check: <path d="m5 12 4 4L19 6" />,

    alert: (
      <>
        <path d="M12 8v5M12 17h.01" />
        <path d="M10.3 3.8 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z" />
      </>
    ),

    trash: (
      <>
        <path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" />
      </>
    ),

    route: (
      <>
        <circle cx="6" cy="18" r="2" />
        <circle cx="18" cy="6" r="2" />
        <path d="M8 18h2a2 2 0 0 0 2-2V8a2 2 0 0 1 2-2h2" />
      </>
    ),

    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),

    image: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="9" cy="10" r="2" />
        <path d="m21 15-5-5L5 20" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name] || paths.grid}
    </svg>
  );
}

function Button({
  children,
  variant = "primary",
  icon,
  onClick,
  type = "button",
  disabled = false,
  className = "",
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  icon?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`btn btn-${variant} ${className}`}
    >
      {icon && <Icon name={icon} size={18} />}
      <span>{children}</span>
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const icon = status === "Picked Up" ? "check" : status === "Processed" ? "route" : "clock";

  return (
    <span className={`status status-${status.toLowerCase().replace(" ", "-")}`}>
      <Icon name={icon} size={14} />
      {status}
    </span>
  );
}

function Logo({ compact = false, onClick }: { compact?: boolean; onClick?: () => void }) {
  return (
    <button className="logo" onClick={onClick} aria-label="HumanLog welcome">
      <span className="logo-mark">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M8 19c0-6 4-10 8-13 4 3 8 7 8 13 0 5-3 8-8 8s-8-3-8-8Z" fill="currentColor" />
          <path
            d="M11 20c3-1 7-4 10-8M15 17c2 0 4 1 6 3"
            fill="none"
            stroke="white"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </span>
      {!compact && (
        <span>
          <strong>HumanLog</strong>
          <small>Good food. Shared with purpose.</small>
        </span>
      )}
    </button>
  );
}

function Welcome({ onNavigate }: { onNavigate: (page: Page) => void }) {
  return (
    <main className="welcome">
      <header className="welcome-header">
        <Logo />
        <Button variant="secondary" onClick={() => onNavigate("overview")}>
          Sign in <Icon name="arrow" size={17} />
        </Button>
      </header>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Food support coordination · Hồ Chí Minh City</span>
          <h1>Good food should find its way to people who need it.</h1>
          <p>
            HumanLog helps local donors, assistance requesters, and coordinators move surplus food
            through trusted storage hubs.
          </p>
          <div className="hero-actions">
            <Button onClick={() => onNavigate("new-donation")}>Donate Food</Button>
            <Button variant="secondary" onClick={() => onNavigate("new-request")}>
              Request Food Assistance
            </Button>
          </div>
          <p className="hero-note">
            <Icon name="alert" size={16} /> Assistance requests describe community needs. They are
            not purchases or reservations.
          </p>
        </div>
        <figure className="hero-image">
          <img
            src="https://images.unsplash.com/photo-1599059813005-11265ba4b4ce?crop=entropy&cs=tinysrgb&fit=crop&fm=jpg&q=82&w=1200"
            alt="Volunteers sorting donated food into boxes"
          />
          <figcaption>Community food coordination, made clearer.</figcaption>
        </figure>
      </section>
      <section className="welcome-steps">
        <div className="section-intro">
          <span className="eyebrow">How HumanLog works</span>
          <h2>From offer or need to coordinated collection</h2>
        </div>
        <div className="steps-grid">
          {[
            [
              "01",
              "Submit details",
              "Share the food available or quantities your community needs.",
            ],
            [
              "02",
              "Suggested storage hub",
              "See the nearest hub by geographic distance and a route preview.",
            ],
            ["03", "Coordinate collection", "Track recorded status updates through pickup."],
          ].map(([n, title, copy]) => (
            <article className="step-card" key={n}>
              <span>{n}</span>
              <div>
                <h3>{title}</h3>
                <p>{copy}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
      <footer className="welcome-footer">
        <Logo />
        <p>Connecting surplus food with community needs.</p>
      </footer>
    </main>
  );
}

function FormField({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  const id = useId();
  const control =
    isValidElement(children) &&
    typeof children.type === "string" &&
    ["input", "select", "textarea"].includes(children.type) ? (
      cloneElement(children as ReactElement<{ id?: string; "aria-describedby"?: string }>, {
        id,
        "aria-describedby": hint ? `${id}-hint` : undefined,
      })
    ) : (
      <div role="group" aria-label={label}>
        {children}
      </div>
    );
  return (
    <div className={`form-field ${error ? "has-error" : ""}`}>
      <label htmlFor={id}>
        <span>{label}</span>
      </label>
      {control}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
      {error && (
        <em>
          <Icon name="alert" size={14} />
          {error}
        </em>
      )}
    </div>
  );
}

function StepRail({ step }: { step: number }) {
  return (
    <div className="step-rail">
      {["Food details", "Location", "Review"].map((label, i) => (
        <div
          className={`${step === i + 1 ? "active" : ""} ${step > i + 1 ? "complete" : ""}`}
          key={label}
        >
          <span>{step > i + 1 ? <Icon name="check" size={15} /> : i + 1}</span>
          <strong>{label}</strong>
        </div>
      ))}
    </div>
  );
}

function ErrorNotice({ children }: { children: ReactNode }) {
  return (
    <div className="submission-error" role="alert">
      <Icon name="alert" />
      <span>{children}</span>
    </div>
  );
}

function AuthPage({
  initialRole,
  onSuccess,
  onBack,
}: {
  initialRole?: "Donor" | "Requester";
  onSuccess: (user: User) => void;
  onBack: () => void;
}) {
  const [register, setRegister] = useState(Boolean(initialRole));

  const [role, setRole] = useState<"Donor" | "Requester">(initialRole || "Donor");

  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");

  const [name, setName] = useState("");

  const [error, setError] = useState("");

  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const result = await api<{ user: User }>(
        `/api/auth/${register ? "register" : "login"}`,
        "POST",
        { email, password, ...(register ? { name, role } : {}) },
      );

      onSuccess(result.user);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <Logo onClick={onBack} />
      <form className="card record-form auth-form" onSubmit={submit}>
        <div className="form-heading">
          <span>HumanLog</span>
          <h2>{register ? "Create your account" : "Sign in"}</h2>
          <p>
            {register
              ? "Offer surplus food or request food assistance."
              : "Your account determines which workspace you can access."}
          </p>
        </div>
        <div className="form-grid">
          {register && (
            <>
              <FormField label="Name or organization">
                <input
                  required
                  maxLength={120}
                  autoComplete="organization"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </FormField>
              <FormField label="Account type">
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as "Donor" | "Requester")}
                >
                  <option>Donor</option>
                  <option>Requester</option>
                </select>
              </FormField>
            </>
          )}
          <FormField label="Email">
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormField>
          <FormField label="Password" hint="10–128 characters">
            <input
              required
              type="password"
              minLength={10}
              maxLength={128}
              autoComplete={register ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FormField>
        </div>
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <div className="form-actions">
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Please wait…" : register ? "Create account" : "Sign in"}
          </Button>
        </div>
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setRegister(!register);
            setError("");
          }}
        >
          {register ? "Already have an account? Sign in" : "Create a donor or requester account"}
        </button>
      </form>
    </main>
  );
}

const coordinatorNav: { page: Page; label: string; icon: string }[] = [
  { page: "overview", label: "Overview", icon: "grid" },
  { page: "donations", label: "Donations", icon: "box" },

  { page: "requests", label: "Food Requests", icon: "clipboard" },
  { page: "warehouses", label: "Warehouses & Routes", icon: "map" },
];

function AppShell({
  user,
  page,
  navigate,
  logout,
  children,
}: {
  user: User;
  page: Page;
  navigate: (page: Page) => void;
  logout: () => void;
  children: ReactNode;
}) {
  const [menu, setMenu] = useState(false);

  const items =
    user.role === "Coordinator"
      ? coordinatorNav
      : user.role === "Donor"
        ? [
            {
              page: "new-donation" as Page,
              label: "Donate Food",
              icon: "plus",
            },
            {
              page: "my-donations" as Page,
              label: "My Donations",
              icon: "box",
            },
          ]
        : [
            {
              page: "new-request" as Page,
              label: "Request Food",
              icon: "plus",
            },
            {
              page: "my-requests" as Page,
              label: "My Requests",
              icon: "clipboard",
            },
          ];

  const title =
    items.find((item) => item.page === page)?.label ||
    (page.includes("confirmation") ? "Submission received" : "Record details");

  return (
    <div className="app-shell">
      {menu && (
        <button
          className="sidebar-scrim"
          onClick={() => setMenu(false)}
          aria-label="Close navigation"
        />
      )}
      <aside className={`sidebar ${menu ? "sidebar-open" : ""}`}>
        <div className="sidebar-top">
          <Logo onClick={() => navigate(home(user.role))} />
          <button
            className="icon-btn sidebar-close"
            onClick={() => setMenu(false)}
            aria-label="Close navigation"
          >
            <Icon name="close" />
          </button>
        </div>
        <nav aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          {items.map((item) => (
            <button
              key={item.page}
              className={`nav-item ${page === item.page ? "active" : ""}`}
              onClick={() => {
                navigate(item.page);
                setMenu(false);
              }}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="city-card">
            <span className="city-icon">
              <Icon name="location" />
            </span>
            <div>
              <strong>Hồ Chí Minh City</strong>
              <small>Food support network</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="icon-btn menu-btn"
              onClick={() => setMenu(true)}
              aria-label="Open navigation"
            >
              <Icon name="menu" />
            </button>
            <div>
              <span>HumanLog workspace</span>
              <h1>{title}</h1>
            </div>
          </div>
          <div className="topbar-actions">
            <div className="account-label">
              <strong>{user.name}</strong>
              <small>{user.role}</small>
            </div>
            <Button variant="ghost" onClick={logout}>
              Sign out
            </Button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

function RouteSummary({ location }: { location: LocationPreview }) {
  return (
    <>
      <div className="suggested">
        <span>
          <Icon name="box" />
        </span>
        <div>
          <small>Suggested nearest warehouse</small>
          <strong>{location.warehouse.name}</strong>
          <em>{location.geographicDistanceKm.toFixed(2)} km geographic distance</em>
        </div>
      </div>
      <LiveMap location={location} />
      {location.route ? (
        <div className="route-stats">
          <span>
            <strong>{location.route.distanceKm} km</strong>
            <small>Road distance</small>
          </span>
          <span>
            <strong>{location.route.durationMinutes} minutes</strong>
            <small>Estimated driving time</small>
          </span>
        </div>
      ) : (
        <p className="route-note">
          Road route unavailable. The nearest warehouse is still calculated from your coordinates.
        </p>
      )}
    </>
  );
}

function LocationPicker({
  address,
  setAddress,
  pin,
  setPin,
}: {
  address: string;
  setAddress: (value: string) => void;
  pin: [number, number] | null;
  setPin: (value: [number, number] | null) => void;
}) {
  const update = (point: [number, number]) => setPin(point);

  const [coordinateError, setCoordinateError] = useState("");

  // Coordinate fields use a div: this component is nested in the submission form.

  const coordinates = useRef<HTMLDivElement>(null);

  return (
    <div className="location-picker">
      <FormField
        label="Location address"
        hint="Enter an address, then continue to look it up with OpenStreetMap."
      >
        <input
          value={address}
          onChange={(e) => {
            setAddress(e.target.value);
            setPin(null);
          }}
          placeholder="Street address, ward, district"
        />
      </FormField>
      <p className="route-note">You can also click the map to select your location.</p>
      <LiveMap pin={pin} onSelect={update} />
      <details className="coordinate-entry">
        <summary>Enter coordinates manually</summary>
        <div ref={coordinates} className="split-field">
          <FormField label="Latitude">
            <input
              name="latitude"
              type="number"
              step="any"
              min="-90"
              max="90"
              placeholder="10.7708"
            />
          </FormField>
          <FormField label="Longitude">
            <input
              name="longitude"
              type="number"
              step="any"
              min="-180"
              max="180"
              placeholder="106.6976"
            />
          </FormField>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            const inputs = coordinates.current?.querySelectorAll("input");

            if (!inputs?.[0].value || !inputs[1].value) {
              setCoordinateError("Enter both coordinates.");
              return;
            }

            const lat = Number(inputs[0].value),
              lon = Number(inputs[1].value);

            if (
              !Number.isFinite(lat) ||
              !Number.isFinite(lon) ||
              Math.abs(lat) > 90 ||
              Math.abs(lon) > 180
            ) {
              setCoordinateError("Enter valid coordinates.");
              return;
            }

            setCoordinateError("");
            update([lat, lon]);
          }}
        >
          Use coordinates
        </Button>
        {coordinateError && <ErrorNotice>{coordinateError}</ErrorNotice>}
      </details>
      {pin && (
        <p className="route-note">
          Selected: {pin[0].toFixed(6)}, {pin[1].toFixed(6)}{" "}
          <button type="button" className="text-button" onClick={() => setPin(null)}>
            Clear pin
          </button>
        </p>
      )}
      <p className="route-note">Address lookup © OpenStreetMap contributors</p>
    </div>
  );
}

function ReviewSummary({
  title,
  address,
  details,
  location,
}: {
  title: string;
  address: string;
  details: string[][];
  location: LocationPreview;
}) {
  return (
    <div className="review">
      <section>
        <h3>Record summary</h3>
        <div className="review-person">
          <span>
            <Icon name="user" />
          </span>
          <div>
            <strong>{title}</strong>
            <small>
              {address || `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`}
            </small>
          </div>
        </div>
        <dl>
          {details.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section>
        <RouteSummary location={location} />
      </section>
    </div>
  );
}

function NewDonation({
  user,
  initial,
  onCancel,
  onSuccess,
}: {
  user: User;
  initial?: Donation;
  onCancel: () => void;
  onSuccess: (record: Donation) => void;
}) {
  const [step, setStep] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");

  const [form, setForm] = useState<DonationInput>({
    donor: initial?.donor || user.name,
    category: initial?.category || "Fresh Food",
    quantityValue: initial?.quantityValue || 0,
    unit: initial?.unit || "units",
    weightValue: initial?.weightValue || 0,
    storage: initial?.storage || "Ambient",
    shelf: initial?.shelf || "Within a Week",
    expiry: "",
    address: initial?.address || "",
  });

  const [pin, setPin] = useState<[number, number] | null>(
    initial ? [initial.latitude, initial.longitude] : null,
  );

  const [location, setLocation] = useState<LocationPreview | null>(null);

  const set = (field: keyof DonationInput, value: string | number) =>
    setForm((previous) => ({ ...previous, [field]: value }));

  const next = async () => {
    setError("");

    if (step === 1) {
      if (
        !Number.isFinite(form.quantityValue) ||
        form.quantityValue <= 0 ||
        !Number.isFinite(form.weightValue) ||
        form.weightValue <= 0
      ) {
        setError("Enter a positive quantity and total weight.");
        return;
      }

      setStep(2);
      return;
    }

    if (!form.donor.trim() || (!form.address.trim() && !pin)) {
      setError("Enter a donor name and an address or map pin.");
      return;
    }

    setBusy(true);

    try {
      setLocation(
        await api<LocationPreview>("/api/location/preview", "POST", {
          address: form.address,
          ...(pin ? { latitude: pin[0], longitude: pin[1] } : {}),
        }),
      );
      setStep(3);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (step !== 3 || !location || busy) return;

    setBusy(true);
    setError("");

    try {
      onSuccess(
        await api<Donation>("/api/donor/donations", "POST", {
          ...form,
          latitude: location.latitude,
          longitude: location.longitude,
        }),
      );
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form-layout">
      <aside>
        <button className="back-link" onClick={onCancel}>
          ← Back to My Donations
        </button>
        <StepRail step={step} />
        <div className="form-help">
          <Icon name="alert" />
          <p>
            <strong>Core submission stays available</strong>
            <small>If a road route is unavailable, the donation can still be submitted.</small>
          </p>
        </div>
      </aside>
      <form className="card record-form" onSubmit={submit}>
        <div className="form-heading">
          <span>Step {step} of 3</span>
          <h2>
            {step === 1
              ? "Tell us about the food"
              : step === 2
                ? "Where should it be collected?"
                : "Review donation"}
          </h2>
          <p>Share accurate details so coordinators can arrange collection.</p>
        </div>
        {step === 1 && (
          <div className="form-grid">
            <FormField label="Food category">
              <select value={form.category} onChange={(e) => set("category", e.target.value)}>
                {foodCategories.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </FormField>
            <div className="split-field">
              <FormField label="Quantity">
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form.quantityValue || ""}
                  onChange={(e) => set("quantityValue", Number(e.target.value))}
                />
              </FormField>
              <FormField label="Unit">
                <select value={form.unit} onChange={(e) => set("unit", e.target.value)}>
                  {["units", "bags", "boxes"].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </FormField>
            </div>
            <FormField label="Total weight (kg)">
              <input
                type="number"
                min="0"
                step="any"
                value={form.weightValue || ""}
                onChange={(e) => set("weightValue", Number(e.target.value))}
              />
            </FormField>
            <FormField label="Storage requirement">
              <div className="segmented">
                {["Ambient", "Chilled", "Frozen"].map((item) => (
                  <button
                    type="button"
                    className={form.storage === item ? "selected" : ""}
                    onClick={() => set("storage", item)}
                    key={item}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </FormField>
            <FormField label="Shelf life">
              <select value={form.shelf} onChange={(e) => set("shelf", e.target.value)}>
                {["Within a Day", "Within a Week", "Within a Month", "Over Six Months"].map(
                  (item) => (
                    <option key={item}>{item}</option>
                  ),
                )}
              </select>
            </FormField>
            <FormField label="Exact expiry (optional)">
              <input
                type="date"
                value={form.expiry}
                onChange={(e) => set("expiry", e.target.value)}
              />
            </FormField>
          </div>
        )}
        {step === 2 && (
          <div className="form-grid">
            <FormField label="Donor name">
              <input value={form.donor} onChange={(e) => set("donor", e.target.value)} />
            </FormField>
            <LocationPicker
              address={form.address}
              setAddress={(value) => set("address", value)}
              pin={pin}
              setPin={setPin}
            />
          </div>
        )}
        {step === 3 && location && (
          <ReviewSummary
            title={form.donor}
            address={form.address}
            details={[
              ["Category", form.category],
              ["Available", `${form.quantityValue} ${form.unit} · ${form.weightValue} kg`],
              ["Storage", form.storage],
              ["Expiry", form.expiry || form.shelf],
            ]}
            location={location}
          />
        )}
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <div className="form-actions">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={step === 1 ? onCancel : () => setStep(step - 1)}
          >
            {step === 1 ? "Cancel" : "Back"}
          </Button>
          {step < 3 ? (
            <Button disabled={busy} onClick={next}>
              {busy ? "Finding nearest warehouse…" : "Continue"}
            </Button>
          ) : (
            <Button type="submit" disabled={busy}>
              {busy ? "Submitting…" : "Submit Donation"}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

function NewRequest({
  user,
  initial,
  onCancel,
  onSuccess,
}: {
  user: User;
  initial?: RequestRecord;
  onCancel: () => void;
  onSuccess: (record: RequestRecord) => void;
}) {
  const [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");

  const [form, setForm] = useState<RequestInput>({
    requester: initial?.requester || user.name,
    address: initial?.address || "",
    foodQuantities: initial?.foodQuantities || { ...noQuantities },
  });

  const [pin, setPin] = useState<[number, number] | null>(
      initial ? [initial.latitude, initial.longitude] : null,
    ),
    [location, setLocation] = useState<LocationPreview | null>(null);

  const next = async () => {
    setError("");

    if (
      !form.requester.trim() ||
      (!form.address.trim() && !pin) ||
      Object.values(form.foodQuantities).some((value) => !Number.isFinite(value) || value < 0) ||
      !Object.values(form.foodQuantities).some((value) => value > 0)
    ) {
      setError(
        "Enter a name, location, and non-negative quantities with at least one greater than zero.",
      );
      return;
    }

    setBusy(true);

    try {
      setLocation(
        await api<LocationPreview>("/api/location/preview", "POST", {
          address: form.address,
          ...(pin ? { latitude: pin[0], longitude: pin[1] } : {}),
        }),
      );
      setReview(true);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!review || !location || busy) return;

    setBusy(true);
    setError("");

    try {
      onSuccess(
        await api<RequestRecord>("/api/requester/requests", "POST", {
          ...form,
          latitude: location.latitude,
          longitude: location.longitude,
        }),
      );
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form-layout">
      <aside>
        <button className="back-link" onClick={onCancel}>
          ← Back to My Requests
        </button>
        <div className="form-help">
          <Icon name="alert" />
          <p>
            <strong>This is an assistance need</strong>
            <small>Submitting does not reserve food or guarantee allocation.</small>
          </p>
        </div>
      </aside>
      <form className="card record-form" onSubmit={submit}>
        <div className="form-heading">
          <span>{review ? "Review" : "Details"}</span>
          <h2>{review ? "Review food request" : "What food assistance is needed?"}</h2>
          <p>Add the quantities your community needs.</p>
        </div>
        {!review ? (
          <div className="form-grid">
            <FormField label="Requester or organization name">
              <input
                value={form.requester}
                onChange={(e) => setForm({ ...form, requester: e.target.value })}
              />
            </FormField>
            <LocationPicker
              address={form.address}
              setAddress={(address) => setForm({ ...form, address })}
              pin={pin}
              setPin={setPin}
            />
            <fieldset className="quantities">
              <legend>Quantities needed</legend>
              <p>Enter 0 for categories not needed.</p>
              {quantityFields.map(([field, label, unit]) => (
                <label key={field}>
                  <span>{label}</span>
                  <div className="unit-input">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={form.foodQuantities[field]}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          foodQuantities: {
                            ...form.foodQuantities,
                            [field]: Number(e.target.value),
                          },
                        })
                      }
                    />
                    <span>{unit}</span>
                  </div>
                </label>
              ))}
            </fieldset>
          </div>
        ) : (
          location && (
            <ReviewSummary
              title={form.requester}
              address={form.address}
              details={quantityFields.map(([field, label, unit]) => [
                label,
                `${form.foodQuantities[field]} ${unit}`,
              ])}
              location={location}
            />
          )
        )}
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <div className="form-actions">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={review ? () => setReview(false) : onCancel}
          >
            {review ? "Back" : "Cancel"}
          </Button>
          {review ? (
            <Button type="submit" disabled={busy}>
              {busy ? "Submitting…" : "Submit Food Request"}
            </Button>
          ) : (
            <Button disabled={busy} onClick={next}>
              {busy ? "Finding nearest warehouse…" : "Review Request"}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

function FoodSummary({ record }: { record: FoodRecord }) {
  return (
    <section className="card food-summary">
      <div className="component-title">
        <span>
          <Icon name={"donor" in record ? "box" : "clipboard"} />
        </span>
        <div>
          <small>{"donor" in record ? "Donated food" : "Requested food"}</small>
          <h3>{"donor" in record ? record.category : record.categories}</h3>
        </div>
      </div>
      {"donor" in record ? (
        <dl>
          <div>
            <dt>Quantity</dt>
            <dd>{record.quantity}</dd>
          </div>
          <div>
            <dt>Weight</dt>
            <dd>{record.weight}</dd>
          </div>
          <div>
            <dt>Expiry</dt>
            <dd>{record.expiry || record.legacy?.originalExpiry || record.shelf}</dd>
          </div>
          <div>
            <dt>Storage</dt>
            <dd>{record.storage}</dd>
          </div>
        </dl>
      ) : (
        <p className="food-copy">{record.quantities}</p>
      )}
    </section>
  );
}

function LogisticsCard({ record }: { record: FoodRecord }) {
  return (
    <section className="card logistics-card">
      <div className="component-title">
        <span>
          <Icon name="box" />
        </span>
        <div>
          <small>Suggested nearest warehouse</small>
          <h3>{record.warehouse}</h3>
        </div>
      </div>
      <p>{record.warehouseAddress}</p>
      <div className="logistics-window">
        <Icon name="location" />
        <div>
          <small>Geographic distance</small>
          <strong>{record.location.geographicDistanceKm.toFixed(2)} km</strong>
        </div>
      </div>
    </section>
  );
}

function ConfirmationPage({
  record,
  navigate,
}: {
  record: FoodRecord;
  navigate: (page: Page) => void;
}) {
  const donation = "donor" in record;

  return (
    <div className="flow-page">
      <section className="confirmation-header">
        <span className="success-seal">
          <Icon name="check" size={28} />
        </span>
        <div>
          <span className="eyebrow">Submission received</span>
          <h2>Your {donation ? "donation" : "food assistance request"} has been submitted</h2>
          <p>A coordinator will review your submission.</p>
          <div className="confirmation-meta">
            <span>
              <small>Record ID</small>
              <strong>{record.id}</strong>
            </span>
            <span>
              <small>Submitted</small>
              <strong>{displayDate(record.submitted)}</strong>
            </span>
          </div>
        </div>
      </section>
      <div className="confirmation-grid">
        <FoodSummary record={record} />
        <LogisticsCard record={record} />
        <section className="card address-card">
          <span>
            <Icon name="location" />
          </span>
          <div>
            <small>{donation ? "Pickup" : "Delivery"} address</small>
            <strong>{record.address}</strong>
            <em>{recordName(record)}</em>
          </div>
        </section>
      </div>
      <div className="confirmation-actions">
        <Button onClick={() => navigate(donation ? "donation-tracking" : "request-tracking")}>
          Track {donation ? "Donation" : "Request"}
        </Button>
        <Button
          variant="secondary"
          onClick={() => navigate(donation ? "my-donations" : "my-requests")}
        >
          View History
        </Button>
      </div>
    </div>
  );
}

function TrackingPage({
  record,
  navigate,
}: {
  record: FoodRecord;
  navigate: (page: Page) => void;
}) {
  const donation = "donor" in record;

  const steps = ["Pending", "Processed", "Picked Up"];

  const current = steps.indexOf(record.status);

  return (
    <div className="flow-page">
      <button
        className="back-link"
        onClick={() => navigate(donation ? "my-donations" : "my-requests")}
      >
        ← Back to history
      </button>
      <section className="tracking-hero">
        <div>
          <span className="eyebrow">{record.id}</span>
          <h2>{record.status}</h2>
          <p>Last updated {displayDate(record.updatedAt)}</p>
        </div>
        <span className="tracking-icon">
          <Icon name="route" size={30} />
        </span>
      </section>
      <div className="tracking-layout">
        <section className="card timeline-card">
          <h3>{donation ? "Donation" : "Request"} progress</h3>
          <div className="status-timeline">
            {steps.map((step, index) => (
              <div
                key={step}
                className={index < current ? "complete" : index === current ? "current" : "future"}
              >
                <span>{index < current ? <Icon name="check" size={16} /> : index + 1}</span>
                <div>
                  <strong>{step}</strong>
                  <small>
                    {index === current
                      ? "Current status"
                      : index === 0
                        ? displayDate(record.submitted)
                        : ""}
                  </small>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="card tracking-map-card">
          <RouteSummary location={record.location} />
          <div className="map-addresses">
            <span>
              <small>{donation ? "Pickup" : "Delivery"}</small>
              <strong>{record.address}</strong>
            </span>
            <Icon name="arrow" />
            <span>
              <small>Warehouse</small>
              <strong>{record.warehouse}</strong>
            </span>
          </div>
        </section>
      </div>
      <div className="tracking-detail-grid">
        <FoodSummary record={record} />
        <LogisticsCard record={record} />
      </div>
    </div>
  );
}

function PersonalHistory({
  kind,
  records,
  navigate,
  view,
  repeat,
}: {
  kind: "donation" | "request";
  records: FoodRecord[];
  navigate: (page: Page) => void;
  view: (record: FoodRecord) => void;
  repeat: (record: FoodRecord) => void;
}) {
  const [tab, setTab] = useState("Active"),
    [search, setSearch] = useState("");

  const filtered = records.filter(
    (record) =>
      `${record.id} ${recordName(record)}`.toLowerCase().includes(search.toLowerCase()) &&
      (tab === "Completed" ? record.status === "Picked Up" : record.status !== "Picked Up"),
  );

  return (
    <div className="page-stack personal-history">
      <section className="page-heading compact">
        <div>
          <h2>My {kind === "donation" ? "Donations" : "Food Requests"}</h2>
          <p>Your submissions and their latest recorded status.</p>
        </div>
        <Button
          icon="plus"
          onClick={() => navigate(kind === "donation" ? "new-donation" : "new-request")}
        >
          {kind === "donation" ? "Donate Food" : "New Food Request"}
        </Button>
      </section>
      <section className="history-metrics">
        <div>
          <small>Total</small>
          <strong>{records.length}</strong>
        </div>
        <div>
          <small>Active</small>
          <strong>{records.filter((record) => record.status !== "Picked Up").length}</strong>
        </div>
        <div>
          <small>Completed</small>
          <strong>{records.filter((record) => record.status === "Picked Up").length}</strong>
        </div>
      </section>
      <section className="history-tools">
        <div className="history-tabs">
          {["Active", "Completed"].map((item) => (
            <button
              key={item}
              className={tab === item ? "active" : ""}
              onClick={() => setTab(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="search-field">
          <Icon name="search" size={18} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by ID or name"
            aria-label="Search my records"
          />
        </div>
      </section>
      {filtered.length === 0 ? (
        <div className="card state-card">
          <Icon name={kind === "donation" ? "box" : "clipboard"} />
          <h3>No {kind === "donation" ? "donations" : "requests"} to show</h3>
          <p>{search ? "Try another search." : "Your submissions will appear here."}</p>
        </div>
      ) : (
        <div className="history-grid">
          {filtered.map((record) => (
            <article className="card history-card" key={record.id}>
              <div className="history-card-top">
                <div>
                  <span>{record.id}</span>
                  <h3>{"donor" in record ? record.category : record.categories}</h3>
                  <p>
                    {"donor" in record
                      ? `${record.quantity} · ${record.weight}`
                      : record.quantities}
                  </p>
                </div>
                <StatusBadge status={record.status} />
              </div>
              <dl>
                <div>
                  <dt>Suggested warehouse</dt>
                  <dd>{record.warehouse}</dd>
                </div>
                <div>
                  <dt>Submitted</dt>
                  <dd>{displayDate(record.submitted)}</dd>
                </div>
              </dl>
              <div className="history-card-actions">
                <Button variant="secondary" onClick={() => view(record)}>
                  View Details
                </Button>
                <Button variant="ghost" onClick={() => repeat(record)}>
                  {kind === "donation" ? "Donate Again" : "Request Again"}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function RecordsPage({
  kind,
  records,
  openDetail,
}: {
  kind: "donation" | "request";
  records: FoodRecord[];
  openDetail: (id: string) => void;
}) {
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState("All statuses"),
    [category, setCategory] = useState("All categories");

  const filtered = records.filter(
    (record) =>
      `${record.id} ${recordName(record)} ${record.address}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (status === "All statuses" || record.status === status) &&
      (category === "All categories" ||
        ("donor" in record ? record.category === category : record.categories.includes(category))),
  );

  return (
    <div className="page-stack">
      <section className="page-heading compact">
        <div>
          <h2>{kind === "donation" ? "Donation records" : "Food assistance needs"}</h2>
          <p>Open a record to edit its details or status.</p>
        </div>
      </section>
      <section className="list-toolbar">
        <div className="search-field">
          <Icon name="search" size={18} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, ID, or address"
            aria-label="Search records"
          />
        </div>
        <div className="filters">
          <label>
            <span>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option>All statuses</option>
              <option>Pending</option>
              <option>Processed</option>
              <option>Picked Up</option>
            </select>
          </label>
          <label>
            <span>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option>All categories</option>
              {foodCategories.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        </div>
      </section>
      <section className="card records-card">
        <div className="records-title">
          <div>
            <h3>All {kind === "donation" ? "Donations" : "Food Requests"}</h3>
            <p>{filtered.length} records</p>
          </div>
        </div>
        {filtered.length === 0 ? (
          <div className="state-card">
            <h3>No records to show</h3>
            <p>New submissions will appear here. Adjust filters if needed.</p>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>{kind === "donation" ? "Donor" : "Requester"}</th>
                    <th>Food details</th>
                    <th>Suggested warehouse</th>
                    <th>Status</th>
                    <th>Submitted</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((record) => (
                    <tr key={record.id} onClick={() => openDetail(record.id)}>
                      <td>
                        <button
                          className="text-button record-id"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDetail(record.id);
                          }}
                        >
                          {record.id}
                        </button>
                      </td>
                      <td>
                        <strong>{recordName(record)}</strong>
                        <small>{record.address}</small>
                        {!record.ownerId && (
                          <small className="unassigned-label">Account not assigned</small>
                        )}
                      </td>
                      <td>
                        <strong>{"donor" in record ? record.category : record.categories}</strong>
                        <small>
                          {"donor" in record
                            ? `${record.quantity} · ${record.weight}`
                            : record.quantities}
                        </small>
                      </td>
                      <td>{record.warehouse}</td>
                      <td>
                        <StatusBadge status={record.status} />
                      </td>
                      <td>{displayDate(record.submitted)}</td>
                      <td>
                        <Icon name="chevron" size={17} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-records">
              {filtered.map((record) => (
                <button
                  className="mobile-record"
                  key={record.id}
                  onClick={() => openDetail(record.id)}
                >
                  <div>
                    <strong className="id-link">{record.id}</strong>
                    <StatusBadge status={record.status} />
                  </div>
                  <h3>{recordName(record)}</h3>
                  {!record.ownerId && <p className="unassigned-label">Account not assigned</p>}
                  <p>
                    {"donor" in record
                      ? `${record.category} · ${record.quantity}`
                      : record.quantities}
                  </p>
                  <dl>
                    <div>
                      <dt>Suggested hub</dt>
                      <dd>{record.warehouse}</dd>
                    </div>
                  </dl>
                </button>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function Overview({
  donations,
  requests,
  warehouses,
  navigate,
  user,
}: {
  donations: Donation[];
  requests: RequestRecord[];
  warehouses: Warehouse[];
  navigate: (page: Page) => void;
  user: User;
}) {
  const pending = [...donations, ...requests].filter((record) => record.status === "Pending");

  const metrics: [string, number, Page, string][] = [
    [
      "Pending Donations",
      donations.filter((record) => record.status === "Pending").length,
      "donations",
      "box",
    ],
    [
      "Pending Requests",
      requests.filter((record) => record.status === "Pending").length,
      "requests",
      "clipboard",
    ],
    [
      "Donations Picked Up",
      donations.filter((record) => record.status === "Picked Up").length,
      "donations",
      "check",
    ],
    ["Active Warehouses", warehouses.length, "warehouses", "map"],
  ];

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div>
          <span className="eyebrow">
            {new Date().toLocaleDateString(undefined, { dateStyle: "full" })}
          </span>
          <h2>Welcome, {user.name}</h2>
          <p>Latest submissions across the food support network.</p>
        </div>
      </section>
      <section className="metrics">
        {metrics.map(([label, count, page, icon]) => (
          <button key={label} className="metric-card" onClick={() => navigate(page)}>
            <span className="metric-icon">
              <Icon name={icon} />
            </span>
            <span className="metric-main">
              <small>{label}</small>
              <strong>{count}</strong>
              <em>Current records</em>
            </span>
            <Icon name="chevron" size={18} />
          </button>
        ))}
      </section>
      <div className="overview-grid">
        <section className="card attention-card">
          <div className="card-header">
            <div>
              <h3>Needs attention</h3>
              <p>Pending records awaiting review</p>
            </div>
          </div>
          <div className="attention-list">
            {pending.length ? (
              pending.slice(0, 5).map((record) => (
                <button
                  key={record.id}
                  onClick={() => navigate("donor" in record ? "donations" : "requests")}
                >
                  <span className="attention-icon amber">
                    <Icon name="clock" />
                  </span>
                  <span>
                    <strong>{recordName(record)}</strong>
                    <small>{record.id}</small>
                  </span>
                  <StatusBadge status={record.status} />
                </button>
              ))
            ) : (
              <p className="empty-copy">No pending records.</p>
            )}
          </div>
        </section>
        <section className="card map-card">
          <div className="card-header">
            <div>
              <h3>Warehouse network</h3>
              <p>{warehouses.length} storage hubs</p>
            </div>
            <button className="text-button" onClick={() => navigate("warehouses")}>
              Open map
            </button>
          </div>
          <LiveMap warehouses={warehouses} />
        </section>
      </div>
    </div>
  );
}

function WarehousesPage({
  records,
  warehouses,
}: {
  records: FoodRecord[];
  warehouses: Warehouse[];
}) {
  const [selected, setSelected] = useState("");

  const record = records.find((record) => record.id === selected) || records[0];

  return (
    <div className="page-stack">
      <section className="page-heading compact">
        <div>
          <h2>Storage hubs and suggested routes</h2>
          <p>Warehouses are ranked by Haversine distance from the selected record.</p>
        </div>
      </section>
      <div className="warehouse-layout">
        <section className="warehouse-list">
          <label className="route-select">
            <span>Select a donation or request</span>
            <select value={record?.id || ""} onChange={(e) => setSelected(e.target.value)}>
              {!records.length && <option>No submissions yet</option>}
              {records.map((record) => (
                <option value={record.id} key={record.id}>
                  {record.id} · {recordName(record)}
                </option>
              ))}
            </select>
          </label>
          <p className="list-caption">
            {record ? "Warehouses ranked by geographic distance" : "Warehouse network"}
          </p>
          {(record?.location.warehouses || warehouses).map((warehouse, index) => (
            <div className="warehouse-card" key={warehouse.name}>
              <span className="warehouse-marker">{index + 1}</span>
              <span>
                <strong>{warehouse.name}</strong>
                <small>{warehouse.address}</small>
                {warehouse.distanceKm !== undefined && (
                  <em>{warehouse.distanceKm.toFixed(2)} km geographic distance</em>
                )}
              </span>
            </div>
          ))}
        </section>
        <section className="card route-map-card">
          {record ? (
            <RouteSummary location={record.location} />
          ) : (
            <LiveMap warehouses={warehouses} detailed />
          )}
          <div className="distance-note">
            <Icon name="alert" size={17} />
            <p>
              <strong>Two distance measures</strong>
              <span>
                Geographic distance is straight-line proximity. The road distance and travel time
                come from OSRM when available.
              </span>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

function DetailDrawer({
  record,
  close,
  save,
  requestDelete,
}: {
  record: FoodRecord;
  close: () => void;
  save: (patch: Record<string, unknown>) => Promise<void>;
  requestDelete: () => void;
}) {
  const donation = "donor" in record;

  const [name, setName] = useState(recordName(record)),
    [address, setAddress] = useState(record.address),
    [status, setStatus] = useState(record.status);
  const [ownerId, setOwnerId] = useState(record.ownerId || "");
  const [accounts, setAccounts] = useState<User[]>([]);
  const [accountError, setAccountError] = useState("");
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [confirmUnits, setConfirmUnits] = useState(false);
  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    setAccountError("");
    try {
      setAccounts(
        await api<User[]>(`/api/coordinator/accounts?role=${donation ? "Donor" : "Requester"}`),
      );
    } catch (error) {
      setAccountError(message(error));
    } finally {
      setAccountsLoading(false);
    }
  }, [donation]);
  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const [category, setCategory] = useState(donation ? record.category : "Fresh Food"),
    [quantity, setQuantity] = useState(donation ? record.quantityValue : 0),
    [weight, setWeight] = useState(donation ? record.weightValue : 0),
    [unit, setUnit] = useState(donation ? record.unit : "units"),
    [storage, setStorage] = useState(donation ? record.storage : "Ambient"),
    [expiry, setExpiry] = useState(donation ? record.expiry : ""),
    [shelf, setShelf] = useState(donation ? record.shelf : "Within a Week");

  const [quantities, setQuantities] = useState(
      donation ? { ...noQuantities } : record.foodQuantities,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");

    const patch: Record<string, unknown> = {
      status,
      ...(ownerId && ownerId !== record.ownerId ? { ownerId } : {}),
      ...(confirmUnits ? { confirmLegacyUnits: true } : {}),
      ...(address !== record.address ? { address } : {}),
      ...(donation
        ? {
            donor: name,
            category,
            quantityValue: quantity,
            weightValue: weight,
            unit,
            storage,
            expiry,
            shelf,
          }
        : { requester: name, foodQuantities: quantities }),
    };

    try {
      await save(patch);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="drawer-layer">
      <button className="drawer-scrim" onClick={close} aria-label="Close details" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Edit record">
        <header>
          <div>
            <span>{donation ? "Donation record" : "Food request"}</span>
            <h2 className="record-id">{record.id}</h2>
          </div>
          <button className="icon-btn" onClick={close} aria-label="Close details">
            <Icon name="close" />
          </button>
        </header>
        <form className="drawer-edit" onSubmit={submit}>
          <div className="drawer-content">
            {!record.ownerId && (
              <div className="ownership-notice">
                Assign this record to the correct {donation ? "donor" : "requester"} account so it
                appears in their personal history.
              </div>
            )}
            <div className="form-grid">
              <FormField
                label="Record owner"
                hint={`Only ${donation ? "Donor" : "Requester"} accounts can own this record.`}
              >
                <select
                  value={ownerId}
                  disabled={accountsLoading}
                  onChange={(e) => setOwnerId(e.target.value)}
                >
                  <option value="">
                    {accountsLoading ? "Loading accounts…" : "Account not assigned"}
                  </option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} · {account.email}
                    </option>
                  ))}
                </select>
              </FormField>
              <div className="account-refresh">
                <p>
                  {!accountsLoading && !accounts.length
                    ? `No ${donation ? "donor" : "requester"} accounts yet. Create the account first, then refresh this list.`
                    : "Choose the account using its email, after checking the record owner."}
                </p>
                <Button
                  variant="ghost"
                  disabled={accountsLoading}
                  onClick={() => void loadAccounts()}
                >
                  Refresh accounts
                </Button>
              </div>
              {accountError && <ErrorNotice>{accountError}</ErrorNotice>}
              <FormField label={donation ? "Donor name" : "Requester name"}>
                <input required value={name} onChange={(e) => setName(e.target.value)} />
              </FormField>
              <FormField label="Address">
                <input required value={address} onChange={(e) => setAddress(e.target.value)} />
              </FormField>
              {donation ? (
                <>
                  <FormField label="Food category">
                    <select value={category} onChange={(e) => setCategory(e.target.value)}>
                      {foodCategories.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </FormField>
                  <div className="split-field">
                    <FormField label="Quantity">
                      <input
                        required
                        type="number"
                        min="0.001"
                        step="any"
                        value={quantity}
                        onChange={(e) => setQuantity(Number(e.target.value))}
                      />
                    </FormField>
                    <FormField label="Unit">
                      <select value={unit} onChange={(e) => setUnit(e.target.value)}>
                        {["units", "bags", "boxes"].map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </FormField>
                  </div>
                  <FormField label="Total weight (kg)">
                    <input
                      required
                      type="number"
                      min="0.001"
                      step="any"
                      value={weight}
                      onChange={(e) => setWeight(Number(e.target.value))}
                    />
                  </FormField>
                  <FormField label="Storage requirement">
                    <select value={storage} onChange={(e) => setStorage(e.target.value)}>
                      {["Ambient", "Chilled", "Frozen"].map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Shelf life">
                    <select value={shelf} onChange={(e) => setShelf(e.target.value)}>
                      {["Within a Day", "Within a Week", "Within a Month", "Over Six Months"].map(
                        (item) => (
                          <option key={item}>{item}</option>
                        ),
                      )}
                    </select>
                  </FormField>
                  <FormField label="Exact expiry (optional)">
                    <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
                  </FormField>
                  {record.legacy?.originalExpiry && !record.expiry && (
                    <p className="route-note">
                      Previous expiry text: {record.legacy.originalExpiry}. Confirm the date before
                      entering it above.
                    </p>
                  )}
                </>
              ) : (
                <fieldset className="quantities">
                  <legend>Requested quantities</legend>
                  {quantityFields.map(([field, label, unit]) => (
                    <label key={field}>
                      <span>
                        {label} ({unit})
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={quantities[field]}
                        onChange={(e) =>
                          setQuantities({
                            ...quantities,
                            [field]: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  ))}
                </fieldset>
              )}
              {record.legacy?.needsUnitReview && (
                <label className="unit-review">
                  <input
                    type="checkbox"
                    checked={confirmUnits}
                    onChange={(e) => setConfirmUnits(e.target.checked)}
                  />
                  <span>I have checked that the quantities use the units shown in this form.</span>
                </label>
              )}
              <FormField label="Status">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as Donation["status"])}
                >
                  <option>Pending</option>
                  <option>Processed</option>
                  <option>Picked Up</option>
                </select>
              </FormField>
            </div>
            <section className="detail-section">
              <h4>Suggested warehouse & route</h4>
              <RouteSummary location={record.location} />
            </section>
            <p className="route-note">
              Submitted {displayDate(record.submitted)} · Updated {displayDate(record.updatedAt)}
            </p>
            {error && <ErrorNotice>{error}</ErrorNotice>}
          </div>
          <footer>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save Changes"}
            </Button>
            <Button variant="danger" icon="trash" disabled={busy} onClick={requestDelete}>
              Delete
            </Button>
          </footer>
        </form>
      </aside>
    </div>
  );
}

function ConfirmDialog({
  id,
  cancel,
  confirm,
}: {
  id: string;
  cancel: () => void;
  confirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");

  return (
    <div className="modal-layer">
      <button className="modal-scrim" onClick={cancel} aria-label="Cancel deletion" />
      <div className="modal" role="dialog" aria-modal="true">
        <span className="modal-icon">
          <Icon name="trash" />
        </span>
        <h2>Delete this record?</h2>
        <p className="record-id">{id}</p>
        <p>This permanently removes the record. Its ID will not be reused.</p>
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <div>
          <Button variant="secondary" disabled={busy} onClick={cancel}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await confirm();
              } catch (error) {
                setError(message(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Deleting…" : "Delete record"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [booting, setBooting] = useState(true),
    [auth, setAuth] = useState(false),
    [signupRole, setSignupRole] = useState<"Donor" | "Requester" | undefined>();

  const [page, setPage] = useState<Page>("welcome"),
    [donations, setDonations] = useState<Donation[]>([]),
    [requests, setRequests] = useState<RequestRecord[]>([]),
    [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [detailId, setDetailId] = useState<string | null>(null),
    [deleteId, setDeleteId] = useState<string | null>(null),
    [flowId, setFlowId] = useState(""),
    [repeat, setRepeat] = useState<FoodRecord | undefined>();

  const generation = useRef(0);

  const detail = useMemo(
    () => [...donations, ...requests].find((record) => record.id === detailId),
    [donations, requests, detailId],
  );

  const flow = useMemo(
    () => [...donations, ...requests].find((record) => record.id === flowId),
    [donations, requests, flowId],
  );

  const navigate = useCallback(
    (target: Page) => {
      const next =
        user && allowed[user.role].includes(target) ? target : user ? home(user.role) : "welcome";

      setPage(next);
      setDetailId(null);
      window.location.hash = next;
      window.scrollTo(0, 0);
    },
    [user],
  );

  const signedIn = (account: User) => {
    generation.current++;
    setDonations([]);
    setRequests([]);
    setWarehouses([]);
    setUser(account);
    setAuth(false);
    setError("");
    setPage(home(account.role));
    window.location.hash = home(account.role);
  };

  const clearSession = useCallback(() => {
    generation.current++;
    setUser(null);
    setDonations([]);
    setRequests([]);
    setWarehouses([]);
    setDetailId(null);
    setDeleteId(null);
    setRepeat(undefined);
    setFlowId("");
    setPage("welcome");
    setAuth(false);
    setError("");
    setNotice("");
    window.location.hash = "welcome";
  }, []);

  useEffect(() => {
    let active = true;

    api<{ user: User }>("/api/auth/me")
      .then((result) => {
        if (active) {
          setUser(result.user);
          const target = window.location.hash.slice(1) as Page;
          setPage(
            allowed[result.user.role].includes(target) &&
              !target.includes("tracking") &&
              !target.includes("confirmation")
              ? target
              : home(result.user.role),
          );
        }
      })
      .catch((error) => {
        if (active && !(error instanceof ApiError && error.status === 401))
          setError(message(error));
      })
      .finally(() => {
        if (active) setBooting(false);
      });

    window.addEventListener("humanlog-session-expired", clearSession);

    return () => {
      active = false;
      window.removeEventListener("humanlog-session-expired", clearSession);
    };
  }, [clearSession]);

  const load = useCallback(
    async (foreground = true) => {
      if (!user) return;

      const current = generation.current;

      if (foreground) setLoading(true);

      try {
        if (user.role === "Donor") {
          const records = await api<Donation[]>("/api/donor/donations");
          if (current === generation.current) setDonations(records);
        } else if (user.role === "Requester") {
          const records = await api<RequestRecord[]>("/api/requester/requests");
          if (current === generation.current) setRequests(records);
        } else {
          const [donationRecords, requestRecords, hubs] = await Promise.all([
            api<Donation[]>("/api/coordinator/donations"),
            api<RequestRecord[]>("/api/coordinator/requests"),
            api<Warehouse[]>("/api/coordinator/warehouses"),
          ]);

          if (current === generation.current) {
            setDonations(donationRecords);
            setRequests(requestRecords);
            setWarehouses(hubs);
          }
        }

        if (current === generation.current) setError("");
      } catch (error) {
        if (current === generation.current) setError(message(error));
      } finally {
        if (current === generation.current) setLoading(false);
      }
    },
    [user],
  );

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => {
      if (!document.hidden) void load(false);
    }, 15000);
    return () => window.clearInterval(interval);
  }, [load]);

  useEffect(() => {
    const changed = () => {
      if (!user) return;
      const target = window.location.hash.slice(1) as Page;
      const next = allowed[user.role].includes(target) ? target : home(user.role);
      setPage(next);
      setDetailId(null);
      if (target !== next) window.location.hash = next;
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, [user]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const save = async (patch: Record<string, unknown>) => {
    if (!detail || user?.role !== "Coordinator") return;

    const resource = "donor" in detail ? "donations" : "requests";

    const updated = await api<FoodRecord>(
      `/api/coordinator/${resource}/${detail.id}`,
      "PATCH",
      patch,
    );

    if ("donor" in updated)
      setDonations((records) =>
        records.map((record) => (record.id === updated.id ? updated : record)),
      );
    else
      setRequests((records) =>
        records.map((record) => (record.id === updated.id ? updated : record)),
      );

    setDetailId(null);
    setNotice("Changes saved.");
  };

  const deleteRecord = async () => {
    if (!deleteId || user?.role !== "Coordinator") return;

    await api(
      `/api/coordinator/${deleteId.startsWith("DN-") ? "donations" : "requests"}/${deleteId}`,
      "DELETE",
    );

    setDonations((records) => records.filter((record) => record.id !== deleteId));
    setRequests((records) => records.filter((record) => record.id !== deleteId));
    setDeleteId(null);
    setDetailId(null);
    setNotice("Record deleted.");
  };

  if (booting)
    return (
      <div className="state-card" role="status">
        Loading your session…
      </div>
    );

  if (!user)
    return auth ? (
      <AuthPage
        key={signupRole || "login"}
        initialRole={signupRole}
        onSuccess={signedIn}
        onBack={() => setAuth(false)}
      />
    ) : (
      <>
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <Welcome
          onNavigate={(target) => {
            setSignupRole(
              target === "new-donation"
                ? "Donor"
                : target === "new-request"
                  ? "Requester"
                  : undefined,
            );
            setAuth(true);
          }}
        />
      </>
    );

  const safePage = allowed[user.role].includes(page) ? page : home(user.role);

  return (
    <AppShell
      user={user}
      page={safePage}
      navigate={navigate}
      logout={() => {
        api("/api/auth/logout", "POST")
          .then(clearSession)
          .catch((error) => setError(message(error)));
      }}
    >
      {error && (
        <ErrorNotice>
          {error}{" "}
          <button className="text-button" onClick={() => void load()}>
            Retry
          </button>
        </ErrorNotice>
      )}
      <div className="refresh-bar">
        <span>{loading ? "Loading records…" : "Status refreshes every 15 seconds"}</span>
        <Button variant="ghost" disabled={loading} onClick={() => void load()}>
          Refresh
        </Button>
      </div>
      {loading && !donations.length && !requests.length ? (
        <div className="card state-card" role="status">
          Loading records…
        </div>
      ) : (
        <>
          {safePage === "overview" && (
            <Overview
              donations={donations}
              requests={requests}
              warehouses={warehouses}
              user={user}
              navigate={navigate}
            />
          )}
          {safePage === "donations" && (
            <RecordsPage kind="donation" records={donations} openDetail={setDetailId} />
          )}
          {safePage === "requests" && (
            <RecordsPage kind="request" records={requests} openDetail={setDetailId} />
          )}
          {safePage === "warehouses" && (
            <WarehousesPage records={[...donations, ...requests]} warehouses={warehouses} />
          )}
          {safePage === "new-donation" && (
            <NewDonation
              user={user}
              initial={repeat && "donor" in repeat ? repeat : undefined}
              onCancel={() => {
                setRepeat(undefined);
                navigate("my-donations");
              }}
              onSuccess={(record) => {
                setRepeat(undefined);
                setDonations((records) => [record, ...records]);
                setFlowId(record.id);
                navigate("donation-confirmation");
              }}
            />
          )}
          {safePage === "new-request" && (
            <NewRequest
              user={user}
              initial={repeat && "requester" in repeat ? repeat : undefined}
              onCancel={() => {
                setRepeat(undefined);
                navigate("my-requests");
              }}
              onSuccess={(record) => {
                setRepeat(undefined);
                setRequests((records) => [record, ...records]);
                setFlowId(record.id);
                navigate("request-confirmation");
              }}
            />
          )}
          {(safePage === "my-donations" || safePage === "my-requests") && (
            <PersonalHistory
              key={safePage}
              kind={safePage === "my-donations" ? "donation" : "request"}
              records={safePage === "my-donations" ? donations : requests}
              navigate={navigate}
              view={(record) => {
                setFlowId(record.id);
                navigate("donor" in record ? "donation-tracking" : "request-tracking");
              }}
              repeat={(record) => {
                setRepeat(record);
                navigate("donor" in record ? "new-donation" : "new-request");
              }}
            />
          )}
          {(safePage.includes("confirmation") || safePage.includes("tracking")) &&
            (flow ? (
              safePage.includes("confirmation") ? (
                <ConfirmationPage record={flow} navigate={navigate} />
              ) : (
                <TrackingPage record={flow} navigate={navigate} />
              )
            ) : (
              <div className="card state-card">
                <h3>Select a record from your history</h3>
                <Button onClick={() => navigate(home(user.role))}>Open My History</Button>
              </div>
            ))}
        </>
      )}
      {detail && user.role === "Coordinator" && (
        <DetailDrawer
          key={detail.id}
          record={detail}
          close={() => setDetailId(null)}
          save={save}
          requestDelete={() => setDeleteId(detail.id)}
        />
      )}
      {deleteId && user.role === "Coordinator" && (
        <ConfirmDialog id={deleteId} cancel={() => setDeleteId(null)} confirm={deleteRecord} />
      )}
      {notice && (
        <div className="toast" role="status">
          <Icon name="check" />
          <div>{notice}</div>
          <button onClick={() => setNotice("")} aria-label="Dismiss notification">
            <Icon name="close" />
          </button>
        </div>
      )}
    </AppShell>
  );
}
