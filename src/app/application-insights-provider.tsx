'use client'

import { AppInsightsContext } from '@microsoft/applicationinsights-react-js'
import { createContext } from 'react'
import { initializeTelemetry } from './application-insights-service'

export const ApplicationInsightsContext = createContext({})

export default function ApplicationInsightsProvider({
  instrumentationKey,  
  children,
}: {
    instrumentationKey: string,
    children: React.ReactNode
}) {
  const { reactPlugin } = initializeTelemetry(instrumentationKey)
  return <AppInsightsContext.Provider value={reactPlugin}>{children}</AppInsightsContext.Provider>
}
