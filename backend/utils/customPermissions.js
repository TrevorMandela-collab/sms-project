const CRUD_RESOURCES = Object.freeze({
  students: "students",
  teachers: "teachers",
  subjects: "subjects",
  classes: "classes",
  assignments: "assignments",
  "assignment-submissions": "assignment submissions",
  announcements: "announcements",
  attendance: "attendance",
  fees: "fees",
  exams: "exams and results",
  timetable: "timetable",
  library: "library books",
  "library-loans": "library loans",
  events: "events",
});

const CRUD_ACTIONS = Object.freeze({
  view: "View",
  create: "Create",
  update: "Update",
  delete: "Delete",
});

const CUSTOM_PERMISSIONS = Object.freeze(
  Object.entries(CRUD_RESOURCES).flatMap(([resource, label]) =>
    Object.entries(CRUD_ACTIONS).map(([action, actionLabel]) => ({
      code: `${resource}.${action}`,
      resource,
      label: `${actionLabel} ${label}`,
      description: `${actionLabel} ${label.toLowerCase()} in the assigned school.`,
    })),
  ),
);

const permissionCodes = new Set(CUSTOM_PERMISSIONS.map(({ code }) => code));

function permissionForRequest(req) {
  const baseUrl = String(req.baseUrl || "").replace(/\/+$/, "");
  const resource = baseUrl.split("/").filter(Boolean).at(-1);
  if (!Object.hasOwn(CRUD_RESOURCES, resource)) return null;

  const method = String(req.method || "").toUpperCase();
  const routePath = String(req.route?.path || req.path || "");
  const isList = routePath === "/";
  const isRecord = routePath === "/:id";
  let action = null;
  if (method === "GET" && (isList || isRecord)) action = "view";
  if (method === "POST" && isList) action = "create";
  if ((method === "PATCH" || method === "PUT") && isRecord) action = "update";
  if (method === "DELETE" && isRecord) action = "delete";
  return action ? `${resource}.${action}` : null;
}

module.exports = {
  CRUD_RESOURCES,
  CUSTOM_PERMISSIONS,
  isCustomPermission: (code) => permissionCodes.has(code),
  permissionForRequest,
};
