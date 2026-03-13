import { Admin, CustomRoutes, Resource } from "react-admin";
import { Route } from "react-router-dom";

import { authProvider } from "./authProvider.js";
import { dataProvider } from "./dataProvider.js";
import { GlobalSkillConfig, GlobalSkillEdit } from "./pages/admin/GlobalSkillConfig.js";
import { JobList as AdminJobList, JobShow } from "./pages/admin/JobList.js";
import { McpToolConfig } from "./pages/admin/McpToolConfig.js";
import { SystemSettings } from "./pages/admin/SystemSettings.js";
import { UserEdit, UserList } from "./pages/admin/UserList.js";
import { AuthCallback } from "./pages/AuthCallback.js";
import { LoginPage } from "./pages/LoginPage.js";
import { AccountLink } from "./pages/user/AccountLink.js";
import { Dashboard } from "./pages/user/Dashboard.js";
import { McpToolSettings } from "./pages/user/McpToolSettings.js";
import { MyInstructions } from "./pages/user/MyInstructions.js";
import { MyJobs } from "./pages/user/MyJobs.js";
import { MySkills, MySkillEdit } from "./pages/user/MySkills.js";

export const App = () => (
  <Admin
    dataProvider={dataProvider}
    authProvider={authProvider}
    dashboard={Dashboard}
    loginPage={LoginPage}
  >
    {(permissions) => (
      <>
        {/* 管理者モード */}
        {permissions === "ADMIN" && (
          <>
            <Resource name="users" list={UserList} edit={UserEdit} />
            <Resource name="jobs/all" list={AdminJobList} show={JobShow} />
            <Resource name="mcp-tools/global" list={McpToolConfig} />
            <Resource name="skills/global" list={GlobalSkillConfig} edit={GlobalSkillEdit} />
          </>
        )}
        {/* 利用者モード */}
        <Resource name="jobs" list={MyJobs} show={JobShow} />
        <Resource name="instructions" list={MyInstructions} />
        <Resource name="mcp-tools" list={McpToolSettings} />
        <Resource name="skills" list={MySkills} edit={MySkillEdit} />
        <CustomRoutes noLayout>
          <Route path="/auth/callback" element={<AuthCallback />} />
        </CustomRoutes>
        <CustomRoutes>
          <Route path="/account-link" element={<AccountLink />} />
          {permissions === "ADMIN" && (
            <Route path="/system-settings" element={<SystemSettings />} />
          )}
        </CustomRoutes>
      </>
    )}
  </Admin>
);
