# LLM-ASSISTED DEVELOPMENT GUIDE - SUMMARY

## ✓ STATUS: COMPLETE & READY

### Primary Deliverable

**LLM_ASSISTED_DEVELOPMENT.docx** (23 KB)
- **Format:** Microsoft Word (.docx)
- **Content:** Professional guide on using Claude/LLMs for Plumbline development
- **Location:** `/mnt/user-data/outputs/PlumlineBuild1/LLM_ASSISTED_DEVELOPMENT.docx`

**Also Available:**
- **LLM_ASSISTED_DEVELOPMENT.md** (24 KB, 1,053 lines) - Markdown format

---

## 📋 DOCUMENT CONTENTS

### 10 Major Sections

1. **Executive Summary**
   - What LLMs are good at (code generation, refactoring, docs)
   - What they're weak at (mathematical proofs, novel algorithms)
   - Key insight: Excellent for patterns, poor for proofs

2. **LLM Capabilities for Each Layer**
   - Layer 1 (Presentation): EXCELLENT ✓
   - Layer 2 (Engine): MODERATE for structure, WEAK for proofs
   - Layer 3 (Data): EXCELLENT ✓
   - Layer 4 (LLM): EXCELLENT ✓
   - Layer 5 (Server): EXCELLENT ✓

3. **Prompting Strategies**
   - Strategy 1: Provide complete context
   - Strategy 2: Show existing patterns
   - Strategy 3: Specify constraints
   - Strategy 4: Ask for verification, not generation

4. **Code Generation Workflows**
   - Workflow 1: Adding a UI page (4 steps)
   - Workflow 2: Adding a data field (5 steps)
   - Both with actual prompts and Claude responses

5. **Architecture & Design Assistance**
   - Using Claude for design decisions
   - Getting refactoring advice
   - Architectural consultation

6. **Testing with LLM Help**
   - Generate engine tests
   - Generate integration tests
   - Test structure and coverage

7. **Code Review & Refactoring**
   - Ask Claude to review code
   - Ask Claude to refactor code
   - Identify bugs and improvements

8. **Worked Examples**
   - Example 1: Add engine tool (4 steps with code)
   - Example 2: Refactor adapters (3 steps with code)
   - Both show real Claude responses

9. **Prompt Templates**
   - Template 1: Generate function
   - Template 2: Add field across layers
   - Template 3: Review code
   - Template 4: Generate tests

10. **Best Practices & Anti-Patterns**
    - ✓ DO: Provide context, show patterns, test code
    - ✗ DON'T: Ask for math proofs, trust without verification

---

## 🎯 KEY INSIGHTS

### What LLMs Excel At

✓ **Code Generation within established patterns**
- UI code (HTML, CSS, JavaScript)
- Adapter code (CRUD operations)
- API endpoints
- Test code
- Documentation

✓ **Refactoring and improving code**
- Extract duplication
- Improve readability
- Optimize performance
- Fix minor bugs

✓ **Explaining and documenting**
- Comment generation
- README writing
- API documentation

---

### What LLMs Struggle With

✗ **Mathematical proofs and certifications**
- Don't ask: "Prove this algorithm is correct"
- Do ask: "Review this algorithm, does it handle edge cases?"

✗ **Novel mathematical insights**
- Don't ask: "Find a faster algorithm for X"
- Do ask: "Implement algorithm X that I specify"

✗ **System design from scratch**
- Don't ask: "Design a better architecture"
- Do ask: "Add this feature following our existing patterns"

---

## 💡 CORE PRINCIPLE

**LLMs are excellent at generating code within established patterns,
but poor at discovering new mathematical proofs.**

For Plumbline:
- ✓ Use LLMs to generate UI, adapters, APIs
- ✓ Use LLMs to write tests and documentation
- ✓ **Manually verify** all mathematical certifications
- ✓ **Never trust** LLM-generated proofs without expert review

---

## 🔧 PROMPTING PATTERNS

### Good Prompt Structure

```
1. CONTEXT: What system are we building?
2. PURPOSE: What does this code do?
3. INPUT/OUTPUT: Show example structures
4. REQUIREMENTS: Specific needs
5. CONSTRAINTS: Limitations (library restrictions, performance, etc)
```

### Bad Prompt

"Generate a function to find bottlenecks."

### Good Prompt

"I'm building Plumbline, an FSM analysis tool. Users model processes
as workflows with states and transitions.

I need a function called findBottlenecks that:
1. Takes a workflow {states: [], transitions: []}
2. Finds states with fan-in > 2
3. Returns [{stateId, fanIn, description}]

Example: [Show example]

Requirements:
- Native JavaScript only
- O(n²) acceptable
- Include comments"
```

---

## 📚 WORKED EXAMPLES

### Example 1: Add Engine Tool

**Step 1:** Ask Claude for analyser function
- Claude generates code

**Step 2:** Ask Claude for certifier function
- Claude generates proof verification

**Step 3:** Ask Claude to add to facade
- Claude integrates into PlumblineEngine

**Step 4:** You verify and test
- Test with real workflows
- Verify certificates are CERTIFIED
- Check edge cases

---

### Example 2: Refactor Adapters

**Step 1:** Show Claude the duplication
- Present LocalAdapter and RemoteAdapter code

**Step 2:** Ask Claude to extract shared logic
- Claude identifies common validation
- Suggests shared function pattern

**Step 3:** You apply the pattern
- Update both adapters
- Verify they still work identically
- Test end-to-end

---

## ✅ BEST PRACTICES

### DO:

✓ **Provide complete context**
- "I'm building Plumbline, a business process FSM tool..."

✓ **Show existing patterns**
- "Here's how other adapters do this, follow same pattern"

✓ **Ask for verification**
- "Review this algorithm for correctness"

✓ **Test generated code**
- Always run tests before integration

✓ **Iterate and refine**
- "Good, but can you also handle X?"

---

### DON'T:

✗ **Ask for mathematical proofs**
- "Prove this algorithm is optimal" - WRONG
- "Review if this is O(n²)" - RIGHT

✗ **Trust without verification**
- Claude-generated code != verified code
- Always test and review

✗ **Ask without context**
- "Generate a function" - too vague
- "Generate a function that..." - clear spec

✗ **Skip the verification step**
- LLM code needs testing
- Mathematical claims need expert review

✗ **Ignore established patterns**
- "Rewrite in a better way" - wrong
- "Follow the same pattern as field X" - right

---

## 🎓 THE IDEAL WORKFLOW

```
1. YOU: Describe what you want (complete context)
   ↓
2. CLAUDE: Generate code following patterns
   ↓
3. YOU: Review and understand the code
   ↓
4. YOU: Test thoroughly
   ↓
5. YOU: Verify it matches requirements
   ↓
6. YOU: Integrate into codebase
   ↓
7. YOU: Run build: python build.py --check
   ↓
8. YOU: Test end-to-end
```

---

## 📊 COMPARISON: When to Use LLM vs Manual

| Task | LLM? | Why |
|------|------|-----|
| Generate UI form | ✓ | Excellent at HTML/CSS/JS |
| Generate API endpoint | ✓ | Excellent at Express patterns |
| Write tests | ✓ | Good at test structure |
| Refactor code | ✓ | Good at improving readability |
| Add database field | ✓ | Good at migrations and queries |
| Verify mathematical proof | ✗ | Poor at rigorous math |
| Design new architecture | ✗ | Better to do manually |
| Optimize algorithm | ✗ | Manual review needed |
| Find new bug patterns | ✗ | Requires domain knowledge |

---

## 💼 PRACTICAL EXAMPLES

### Use Case 1: Add Field to Data Layer

```
Prompt: "Add 'priority' field (1-5) to workflows.
Generate:
1. Database migration
2. LocalAdapter update
3. RemoteAdapter update
4. Server endpoint update

All must have identical signatures."

Claude generates all four parts.

You verify:
- Signatures match
- Database schema correct
- Both adapters work
- python build.py --check passes
```

---

### Use Case 2: Generate UI Component

```
Prompt: "Create form for saving Plumbline workflows.
Fields: Name, Description, Tags
Requirements:
- Use existing CSS from studio.css
- Call PlumblineData.saveWorkflow() on submit
- Show validation errors inline
- Accessible (ARIA labels)"

Claude generates complete HTML + JavaScript.

You verify:
- Looks consistent with existing UI
- Event handlers work
- Calls facade correctly
- No console errors
```

---

### Use Case 3: Review Algorithm

```
Prompt: "Review this bottleneck detection algorithm.
Check for:
1. Correctness of fan-in calculation
2. Edge cases (empty states, etc)
3. Time complexity
4. Any bugs I missed

[Show code]

Don't rewrite, just identify issues."

Claude provides detailed review.

You fix issues Claude identified.
Then verify with tests.
```

---

## 🚀 GETTING STARTED

1. **Read the main guide** (LLM_ASSISTED_DEVELOPMENT.docx)
2. **Study the prompting strategies** (Section 3)
3. **Try the worked examples** (Section 8)
4. **Use the templates** (Section 9)
5. **Follow best practices** (Section 10)

---

## 📞 QUICK REFERENCE

**Layer 1 (Presentation):** EXCELLENT - UI code, CSS, JS
**Layer 2 (Engine):** MODERATE - code structure, WEAK on proofs
**Layer 3 (Data):** EXCELLENT - adapters, migrations, queries
**Layer 4 (LLM):** EXCELLENT - understanding LLM capabilities
**Layer 5 (Server):** EXCELLENT - API endpoints, auth, DB

---

**Plumbline 6 — Layered Studio**  
**LLM-Assisted Development Guide**  
**Version 1.0 — 2026-07-04**

✓ **READY FOR DEVELOPMENT TEAM**

Use LLMs for leverage. Use your judgment for verification.

