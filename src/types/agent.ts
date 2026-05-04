export type SchedulingRequest = {
  selectedDate: string
  currentTime: string
  workingHours: Array<{
    start: string
    end: string
  }>
  scheduledTasks: Array<{
    taskId: string
    title: string
    start: string
    end: string
    status: string
  }>
  unscheduledTasks: Array<{
    taskId: string
    title: string
    estimatedMinutes?: number | null
    priority?: string | null
    userTimeHint?: string | null
    status: string
    needs_analysis: boolean
  }>
}

export type SchedulingResponse = {
  task_updates: Array<{
    taskId: string
    title: string
    estimatedMinutes: number
    priority: "low" | "medium" | "high"
    timeHint: string
    ai_suggestions: string[]
  }>
  schedule_result: {
    scheduled: Array<{
      taskId: string
      start: string
      end: string
    }>
    unscheduled: Array<{
      taskId: string
      reason: string
    }>
  }
}

export type SummaryRequest = {
  date: string
  tasks: Array<{
    taskId: string
    title: string
    status: string
    isScheduled: boolean
    priority: string
    estimatedMinutes?: number | null
    conclusion: string
  }>
}

export type SummaryResponse = {
  text: string
}

export type APIError = {
  error: string
  message: string
}

/** macOS / legacy-aligned names */
export type SchedulingServiceRequest = SchedulingRequest
export type SchedulingLLMResponse = SchedulingResponse
export type SummaryServiceRequest = SummaryRequest
export type SummaryServiceResponse = SummaryResponse
