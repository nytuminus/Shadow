export interface EmployeeInfo {
  id: string;
  username: string;
  name: string;
}

export interface LoginResult {
  token: string;
  employee: EmployeeInfo;
}
