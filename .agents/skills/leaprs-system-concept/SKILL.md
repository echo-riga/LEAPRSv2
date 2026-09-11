---
name: leaprs-system-concept
description: Core system workflow, business logic, entity model, and dynamic forms concept for LEAPRS.
---

# LEAPRS System Concept & Core Workflow

This document explains the conceptual architecture and functional flows of the **Lifelong Education Advancement Program Requisition System (LEAPRS)**.

---

## 1. System Overview

LEAPRS is designed to manage capacity/capital development projects (CapDev), employee requests (requisitions) associated with those projects, and status timelines of individual requests.

```mermaid
graph TD
    Admin[Admin] -->|Creates/Configures| CapDev[CapDev Project]
    Admin -->|Configures forms| Config[Field Configurations]
    User[User / Staff] -->|Submits Request against CapDev| Request[Request]
    Request -->|Follows| Config
    User & Admin -->|Post updates| Timeline[Timeline Logs]
```

---

## 2. Core Entities

### A. CapDev (Capital/Capacity Development)
A CapDev is a parent project or educational program.
* **Fixed Fields (In Codebase)**:
  * `AIP Code` (Unique project code)
  * `Initial Budget` (Original project fund)
  * `Remaining Budget` (Available project fund after deductions)
  * `Department` (Owner department)
  * Fixed fields remain interactive in the form preview, but their layout is not configurable: they cannot be edited, deleted, or dragged.
* **Dynamic Fields (Configurable by Admin)**:
  * Custom description, tags, target audience, etc.
  * Stored in `additional_info` JSONB column.
  * Fields configured in the `required` section are displayed with the fixed Required Information fields and must be completed before a project can be created or updated. Other configured fields are grouped under the exact section names configured by the admin; do not collapse them into a generic additional-information section.
  * Dynamic fields remain fully configurable—including edit, delete, and drag-and-drop—regardless of whether they are placed in the `required` section or any other section.

### B. Requests
Requisitions filed by employees against a specific CapDev.
* **Fixed Fields (In Codebase)**:
  * `Setting` (Internal or External)
  * `Requested Budget` (Cost estimation)
  * Fixed fields remain interactive in the form preview, but their layout is not configurable: they cannot be edited, deleted, or dragged.
* **Dynamic Fields (Configurable by Admin)**:
  * Attendance sheets (file type), feedback links, etc.
  * Stored in `additional_info` JSONB column.
  * Dynamic fields remain fully configurable—including edit, delete, and drag-and-drop—regardless of whether they are placed in the `required` section or any other section.

### C. Status Updates (Timeline)
Chronological logs track request progression. Status updates are **fixed** (not dynamic) and consist of:
* Status update text
* Remarks
* Multi-file uploads (via Google Drive integration)
* `status_mark` (required enum: `pending`, `completed`, `denied`). Setting a status mark on an individual status update indicates the status of that specific step and does *not* prematurely close or deny the entire request timeline.
* `mark_as_complete` (boolean)
* `subtracts_requested_amount` (boolean with configurable deduction amount modal)

---

## 3. Key Business Constraints & Logic

### A. One-Time Timeline Flags
* **Timeline Completion**: Once a status update has `mark_as_complete = true` or the request is concluded as Completed via timeline resolution, the request is finished. No further updates are permitted.
* **Budget Deduction**: Once a status update has `subtracts_requested_amount = true`, the deduction modal opens allowing the user to review/edit the amount deducted before it is subtracted from the parent CapDev's balance. Only one status update per request can trigger this deduction.
* **Budget Availability**: A request's requested budget cannot exceed its parent CapDev's remaining budget. The same check is enforced again when a deduction status update is saved.
* **Budget History**: A CapDev stores its initial and remaining budgets. Its details view lists every deducted request amount and the status-update author.
* *Enforcement*: Enforced via PostgreSQL partial unique indexes to block concurrency race conditions.

### B. File Uploads (Google Drive)
All files are uploaded to Google Drive.
* **Folder Naming Structure**: `[Username] - [Date Submitted] - [Request Name]`
* **Database Reference**: Array of JSON objects stored in the `files` JSONB column of the status update.

### C. Form Configuration & Custom Layouts
* Admins can configure the forms for CapDev and Requests.
* Dynamic field types supported: `text` (combobox: dropdown + text entry), `number`, `date` (datepicker), `file` (drag & drop upload).

### D. Cascading Entity Deletions
* **Allow Delete & Cascade Children**: When deleting any parent entity (such as a CapDev project or a Requisition request), the system must permit deletion by automatically removing all attached foreign-key child records (e.g., status updates, timeline logs, and sub-references) in the same operation. Never block parent deletion due to existing child history logs.

### E. Request Status vs. Status Update Marks
* **Whole Request Statuses**: `in_progress`, `completed`, `denied`.
* **Individual Status Update Marks**: `pending`, `completed`, `denied`.
* Marking a status update as `denied` or `completed` documents that specific milestone without terminating or overriding the overarching request timeline. Only explicit concluding actions (`Complete` or `Deny` resolution) finalize the request.

### F. Post-Completion Training Feedback & Evaluation Google Forms
* Upon concluding a request as **Completed**, the system generates links to two Google Forms for feedback and post-training evaluation:
  1. **Participant Evaluation & Feedback Form**: For participants/attendees to rate training content, trainer delivery, and logistics (`https://forms.gle/c8BjUUoPxYWiBxnF8`).
  2. **Supervisor / Post-Activity Evaluation Form**: For supervisors and coordinators to assess workplace application, action plans, and skill improvements (`https://forms.gle/c8BjUUoPxYWiBxnF8`).
* The forms are presented via a celebratory completion modal dialog immediately upon completion, and persist in the timeline's final resolution card with direct **Open Form** and **Copy Link** actions.

