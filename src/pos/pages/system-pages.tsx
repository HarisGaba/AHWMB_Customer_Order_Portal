/**
 * Admin System pages inside the POS: Stock Report and Customer Report. They reuse the portal's own components (same data, same
 * database tables and browser storage), styled by a copy of the portal stylesheet that
 * only applies inside .portal-embed, so the POS look is not affected.
 */
import "../portal-embed.css"
import { StockReport } from "../../components/StockReport"
import { CustomerReport, DailyReports, PurchaseReport } from "../../App"
import { UsersAdmin } from "../../components/UsersAdmin"
import { can } from "../../lib/access"
import { usePosAccess } from "@/components/auth-gate"

const Embed = ({ children }: { children: React.ReactNode }) => <div className="portal-embed"><div className="ltr-mode">{children}</div></div>

export function StockReportPage() {
  const access = usePosAccess()
  return <Embed><StockReport canEdit={can(access, "stock_report")} canTransfer={can(access, "stock_transfer")} /></Embed>
}
export const CustomerReportPage = () => <Embed><CustomerReport /></Embed>
export const DailyReportPage = () => <Embed><DailyReports language="en" onBack={() => undefined} /></Embed>
export const PurchaseReportPage = () => <Embed><PurchaseReport /></Embed>
export const UsersPage = () => <Embed><UsersAdmin /></Embed>
