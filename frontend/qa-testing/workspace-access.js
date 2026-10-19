(function (root) {
  function modulesForRole(modules, role) {
    const moduleRole = role === "school_admin" ? "admin" : role;
    return modules.filter(function (entry) {
      return entry.roles.includes(moduleRole);
    });
  }

  if (typeof module === "object" && module.exports) {
    module.exports = modulesForRole;
  } else {
    root.QAWorkspaceAccess = modulesForRole;
  }
})(globalThis);
