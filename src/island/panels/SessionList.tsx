import styles from "./CodePanel.module.css";

/** Live Claude Code sessions. Filled in once hooks are connected. */
export function SessionList() {
  return (
    <>
      <span className={styles.heading}>Sessions</span>
      <div className={styles.sessionsEmpty}>
        <span className={styles.emptyTitle}>No live sessions yet</span>
        <span className={styles.emptyHint}>Live session status arrives with the hook connection.</span>
      </div>
    </>
  );
}
