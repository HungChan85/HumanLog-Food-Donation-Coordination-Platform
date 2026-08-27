# HumanLog — Food Donation Coordination Platform

> 🏆 **Top 10 Finalist (out of 200+ teams)** at the HumanLog Hackathon.

An end-to-end web coordination platform designed to bridge the gap between food donors (restaurants, supermarkets), food storage providers, charities, local authorities, and beneficiaries to streamline surplus food redistribution and reduce food waste.

---

## 🚧 Project Status: Work in Progress (Active Development)
> **Note:** This project originated as an award-winning prototype developed during a competitive hackathon. It is currently undergoing refactoring, feature enhancements, and continuous architectural upgrades to transition into a production-grade platform. Stay tuned for upcoming updates!

---

## 🌟 Problem & Mission
Every day, massive quantities of edible surplus food from restaurants and retailers go to waste, while charitable organizations and vulnerable communities face food insecurity due to fragmented logistics and communication channels. 

**HumanLog** provides a centralized, multi-role dispatch and management platform that connects donors, storage hubs, charities, and coordinators in real-time, ensuring surplus food is safely and efficiently delivered to where it is needed most.

---

## 🚀 Key Features & Multi-Role Architecture

- **Role-Based Workflows & Dashboards:** Custom interfaces and permission scopes for:
  - **Donors (Restaurants / Stores):** List surplus food batches, expiry details, and pickup windows.
  - **Charities & Beneficiaries:** Submit food aid requests and track allocation statuses.
  - **Storage & Logistics Hubs:** Monitor inventory capacity, cold chain status, and distribution routing.
  - **Admin & Local Authorities:** Audit logs, oversee donation pipelines, and coordinate crisis relief.
- **Donation & Request Lifecycle Management:** End-to-end status tracking from food posting to verification and final delivery.
- **Responsive & Intuitive Interface:** Clean, accessible user experience tailored for fast actions during field operations.

---

## 🛠️ Tech Stack

### Backend
- **Framework:** Python / Flask
- **Database:** SQLite / Relational Schema (designed for multi-entity relationships)
- **API:** RESTful API Architecture

### Frontend
- **Languages:** HTML5, CSS3, JavaScript (Jinja2 Templates)
- **Design:** Responsive UI with customized workflow components

---

## 📂 Repository Structure (Current State)

```text
├── backend/
│   ├── templates/          # Role-based UI views & dashboards (Admin, Requester, Donor)
│   ├── static/             # Assets, images, and stylesheets
│   ├── app.py              # Application entry point, routing & REST APIs
│   ├── requirements.txt    # Python runtime dependencies
│   └── Procfile            # Deployment configuration
└── README.md
```

---

## ⚡ Quick Start & Local Setup

### Prerequisites
- Python 3.10+
- `pip` package manager

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/<your-username>/HumanLog----Food-Donation-Coordination-Platform.git
   cd HumanLog----Food-Donation-Coordination-Platform/backend
   ```

2. **Create and activate a virtual environment:**
   ```bash
   # On macOS/Linux
   python3 -m venv venv
   source venv/bin/activate

   # On Windows
   python -m venv venv
   venv\Scripts\activate
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

4. **Run the application:**
   ```bash
   python app.py
   ```
5. **Access the platform:** Open your browser and navigate to `http://127.0.0.1:5000`.

---

## 🗺️ Roadmap & Upcoming Improvements

- [x] Hackathon MVP with multi-role dashboards and core request/donation flow.
- [ ] **Architecture Refactoring:** Modularize backend into blueprints and domain services.
- [ ] **Database Migration:** Upgrade from SQLite to PostgreSQL with full ORM (SQLAlchemy).
- [ ] **Real-time Notifications:** WebSockets / Email notifications for critical dispatch updates.
- [ ] **Logistics & Route Optimization:** Automated matching between donors, storage hubs, and charities.
- [ ] **Containerization & CI/CD:** Dockerize full stack and automate test/deployment pipelines.

---

## 👥 Contributors & Hackathon Team
Developed with passion during the **HumanLog Hackathon**, placing **Top 10 / 200+ teams**.
- **Role & Contributions:** Backend REST API design, Relational database architecture, and Frontend interface implementation.

---
*Contributions, suggestions, and feedback are always welcome! Feel free to open an issue or pull request.*

