# Todo-Driven Workflow Example
Here is a concrete example of how to implement the Todo-Driven Workflow using VS Code's `manage_todo_list` tool.

## The Goal: Add a User Authentication Endpoint

1. **Initialize the List**: Before writing code, call `manage_todo_list` with these items:
   - ID: 1, Title: "Write auth tests", Status: "not-started"
   - ID: 2, Title: "Implement /login API", Status: "not-started"
   - ID: 3, Title: "Verify DB connection", Status: "not-started"

2. **Start Task 1**: Call `manage_todo_list` to set ID 1 to "in-progress".

3. **Execute**: Create `tests/auth.test.js` and write the tests.

4. **Verify**: Run the tests using `run_in_terminal` (`npm test`). They should fail (Red).

5. **Complete Task 1**: Call `manage_todo_list` to set ID 1 to "completed".

6. **Start Task 2**: Call `manage_todo_list` to set ID 2 to "in-progress".
...and so on.

**CRITICAL**: Do NOT just type out a checklist in markdown. You MUST call the `manage_todo_list` tool.
