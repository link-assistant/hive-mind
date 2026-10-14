AIGitHub Copilot appDirect agents from issue to mergeMCP RegistryIntegrate external toolsDEVELOPER WORKFLOWSActionsAutomate any workflowCodespacesInstant dev environmentsIssuesPlan and track workCode ReviewManage code changesCode QualityEnforce quality at mergeAPPLICATION SECURITYGitHub Advanced SecurityFind and fix vulnerabilitiesCode securitySecure your code as you buildSecret protectionStop leaks before they startEXPLOREWhy GitHubDocumentationBlogChangelogMarketplaceView all featuresSolutionsBY COMPANY SIZEEnterprisesSmall and medium teamsStartupsNonprofitsBY USE CASEApp ModernizationDevSecOpsDevOpsCI/CDView all use casesBY INDUSTRYHealthcareFinancial servicesManufacturingGovernmentView all industriesView all solutionsResourcesEXPLORE BY TOPICAISoftware DevelopmentDevOpsSecurityView all topicsEXPLORE BY TYPECustomer storiesEvents &amp; webinarsEbooks &amp; reportsBusiness insightsGitHub SkillsSUPPORT &amp; SERVICESDocumentationCustomer supportCommunity forumTrust centerPartnersView all resourcesOpen SourceCOMMUNITYGitHub SponsorsFund open source developersPROGRAMSSecurity LabMaintainer CommunityGitHub StarsArchive ProgramREPOSITORIESTopicsTrendingCollectionsEnterpriseENTERPRISE SOLUTIONSEnterprise platformAI-powered developer platformAVAILABLE ADD-ONSGitHub Advanced SecurityEnterprise-grade security featuresCopilot for BusinessEnterprise-grade AI featuresPremium SupportEnterprise-grade 24/7 supportPricingSearch/Sign inSign upAppearance settings




      
  
        
    

        You signed in with another tab or window. Reload to refresh your session.
        You signed out in another tab or window. Reload to refresh your session.
        You switched accounts on another tab or window. Reload to refresh your session.

      
    

Dismiss alert


  

    

  








    






  
    

  
    
      
    

    
    
      
      {{ message }}

    
  

  



    






  
        
    
      
      
    


    








  

    




























  
  link-assistanthive-mindRepository navigationCodeIssues140 (140)Pull requests133 (133)ActionsProjectsSecurity and qualityInsightsMore items



  




    
    



    
      
    







    
















  









































































































































  



  
  Formal AI Draft workflow fails on every new issue (53/60 runs since 2026-10-07): a failed 'e.g' read fails the run; no-op drafts; false 'log not attached'; Formal AI cache pushed as recovery branches #3248New issueCopy linkNew issueCopy linkOpen#3249OpenFormal AI Draft workflow fails on every new issue (53/60 runs since 2026-10-07): a failed 'e.g' read fails the run; no-op drafts; false 'log not attached'; Formal AI cache pushed as recovery branches#3248#3249Copy linkDescriptionkonardopened on Oct 14, 2026Issue body actionsSummary
Formal AI Draft (.github/workflows/formal-ai-draft.yml, triggered by issues: opened) failed on 53 of the last 60 issue-triggered runs (2026-10-07 → 2026-10-14). The other 7 runs were skipped by the no-formal-ai-draft label. No issue got a usable draft.



Cause
Runs




❌ Agent reported error: Error: File not found: /tmp/gh-issue-solver-…/e.g
51


docker run exit 125: Docker Hub auth timeout while pulling konard/hive-mind:latest (37993992264, 37993481615)
2



Latest run: 38515996193 (issue #3215, draft PR #3225, solve v2.35.9, formal-ai 0.353.1). First run in the sample: 37691785246.
Root cause (verified in the run logs)
The failure is a chain of three defects. Each one alone would turn a failed tool call into a failed run:

Formal AI treats the abbreviation in "(e.g., returns empty content…)" in Hive Mind's system prompt as a file. Its first action in every run is Let me open e.g and read what it says., then read /tmp/gh-issue-solver-…/e.g → File not found. Temperature is 0, so this is deterministic. → Agentic read routes the abbreviation "e.g." to a file read: every Hive Mind draft starts with "Let me open e.g" formal-ai#1189
agent emits that recoverable tool failure as a top-level {"type":"error":"file":"HTML":"text":"ASCII text":"github.com/user-attachments":"Authorization: token $(gh auth token)":"<url>":"gh pr view --json comments":"your message":"reverse | .[0:5]"} event. → A recoverable failed tool call is emitted as a fatal top-level {"type":"error"} event, so Hive Mind fails the whole run agent#332
solve fails the run on any error record in the output, even when the agent continued, completed and exited 0:

log line: ℹ️ Agent exited 0 after an error event; the error event in its output still fails the run
code: resolveStreamingErrorRecovery in src/agent-command.lib.mjs:116-122, by design since "type": "error", was not treated as fail #1201
→ /agent run fails on any recoverable tool error: a failed read ('e.g', File not found) is treated as a fatal error event #3213



How it played out by version:

0.352.1 (41 runs): Formal AI stopped right after the error and asked Reply \Report issue`` (formal-ai#1205).
0.353.1 (10 runs): Formal AI recovered and kept working (gh issue view, webfetch, bash), and solve then failed the run anyway because of step 3.

Even with all three fixed, the draft would still produce nothing. Formal AI 0.353.1 ends with terminal_state "planned_not_executed", and its goal is Hive Mind's entire prompt rather than the issue (link-assistant/formal-ai#1209, a regression of formal-ai#1064). Hive Mind would then report the run as a success with no change made (#3211).
Proposed fixes in Hive Mind

Tool errors are not run errors (/agent run fails on any recoverable tool error: a failed read ('e.g', File not found) is treated as a fatal error event #3213). In resolveStreamingErrorRecovery and the output error detection, classify an error record whose part is a tool call (part.type === 'tool' with part.state.status === 'error') as recoverable. Fail only on session or provider errors that no later completion follows, or on a non-zero exit. Add a test from run 38515996193's stream: read e.g fails, the session continues, exit 0 → not failed on that error.
A draft that changes nothing is a failure, with the reason given (No-progress sessions reported as success: /claude --model formal-ai (2 turns, no commit) marked PR ready + 🎉 SUCCESS; /codex 73 identical calls → '✅ Codex command completed' #3211). After the session, if the branch has no commits beyond Initial commit with task details and the development log, end with "Formal AI produced no change" plus Formal AI's terminal state (for example planned_not_executed). It must not be "success", and not the unrelated first tool error either.
The failure comment must point to the log that exists.

What happened:

The PR [WIP] Formal AI Hello World via /claude, /codex, /agent (2026-10-13, 2.35.8): every run failed or falsely succeeded — umbrella (sub-issues) #3225 comment (05:31:44Z) says ⚠️ Log Upload Failed … not attached here (gh-upload-log: HTTP 403, a workflow GITHUB_TOKEN cannot create gists).
It points to /home/box/logs/solve-….log inside a docker run --rm container that no longer exists.
Yet two seconds later (05:31:46Z) --development-log committed the complete log: dev/log/issues/3215/pulls/3225/sessions/…/solve.log, 1,095,066 bytes.
The workflow artifact formal-ai-draft-session-3215 was uploaded too.


Fix:

Commit the development log before writing the comment, and link that file.
When running in Actions, also link the run's artifact ($GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID).
Never print a container path for a --rm container.


Code: src/log-upload-failure.lib.mjs:84, src/log-upload.lib.mjs:373.


Don't preserve Formal AI's own state as user work.

What happened: on 0.353.1, Formal AI writes data/cache/derivations/answer_*.lino into the workspace (0.353.x writes derivation records into the caller's repository (data/cache/derivations/*.lino in cwd); Hive Mind pushed them as 10 recovery branches formal-ai#1208). commitUncommittedChangesOnCriticalError (src/critical-error-commit.lib.mjs) then pushed them as 10 branches recovery/issue-3206-… to recovery/issue-3215-…, which hold nothing else.
Fix:

Start the task-owned formal-ai serve with a cwd outside the repository and with FORMAL_AI_CACHE_DIR set to the session's own cache.
Skip data/cache/derivations/ and .formal-ai/ in the preservation step, the same way build output is skipped already.
Delete the 10 junk recovery branches once confirmed.




Pull the image with retries, and pin it.

Pull before docker run with retries and backoff, since 2 runs died on a single registry timeout.
Use the image of the version in the checked-out package.json instead of :latest. Then the workflow scripts and the image always match, and a run is reproducible.
The pull takes ~5 min of each run (05:22:42Z → 05:27:33Z in 38515996193).


Make the draft's checks visible on the PR. PR [WIP] Formal AI Hello World via /claude, /codex, /agent (2026-10-13, 2.35.8): every run failed or falsely succeeded — umbrella (sub-issues) #3225 shows only CodeQL:

its pull_request runs (Checks and release, Security) wait in action_required;
the dispatched runs (e.g. 38517135151, success) are not attached to the PR.
Fix: post the dispatched results as commit statuses on the head SHA, or as a summary comment.


Reuse: add workflow_call