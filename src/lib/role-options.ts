export const ROLE_OPTIONS = [
  {
    value: 'admin',
    label: 'Admin',
    description: 'Manages users, settings, CapDev projects, and all requests.',
  },
  {
    value: 'employee',
    label: 'Employee',
    description: 'Manages their own requests and responds to active stoppers.',
  },
  {
    value: 'employee-department',
    label: 'Employee (All Department Requests)',
    description: 'Manages requests and stoppers across all departments; self-registration requires admin approval.',
  },
  {
    value: 'viewer',
    label: 'Viewer',
    description: 'Views projects and requests in their department.',
  },
  {
    value: 'viewer-full',
    label: 'Viewer (All Departments)',
    description: 'Views projects and requests across all departments.',
  },
] as const;

export type RoleValue = (typeof ROLE_OPTIONS)[number]['value'];

export const roleLabel = (role: string) =>
  ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role;
