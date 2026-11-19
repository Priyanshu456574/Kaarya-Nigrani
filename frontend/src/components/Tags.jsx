import { useT } from '../strings'

const ISSUE_KIND = {
  REPORTED: 'claim', ACKNOWLEDGED: 'claim', UNDER_EXAMINATION: 'claim',
  VERIFIED: 'defect', ACTION_ASSIGNED: 'defect', RECTIFIED: 'defect',
  CLOSED: 'done', NOT_SUBSTANTIATED: 'neutral',
}
const WORK_KIND = { SANCTIONED: 'neutral', IN_PROGRESS: 'neutral', REPORTED_COMPLETE: 'claim', USABLE_VERIFIED: 'done' }

export function IssueTag({ issue }) {
  const { issueStatus } = useT()
  return <span className={`tag ${ISSUE_KIND[issue.status]}`}>{issueStatus[issue.status]}</span>
}

export function WorkTag({ status }) {
  const { workStatus } = useT()
  return <span className={`tag ${WORK_KIND[status]}`}>{workStatus[status]}</span>
}

export const issueKind = (s) => ISSUE_KIND[s]
