"use client";

import { readPortal } from '@/lib/portal-read-client';
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Assessment as ReportIcon,
  CheckBox as SelectAllIcon,
  DescriptionOutlined as RequestReportIcon,
  Download as DownloadIcon,
  FilterAlt as FilterIcon,
  Refresh as ResetIcon,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Grid,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import {
  generateMonitoringSheet,
  generateRequestReportPdf,
  type getMonitoringReportData,
  getRequestReportData,
  type RequestReportData,
  type RequestReportRow,
} from "@/app/actions";
import { manilaDate, manilaDateBoundary } from "@/lib/manila-date";
import DateField from "@/components/DateField";
import { getDynamicFieldValue } from "@/lib/dynamic-fields";
import { ReportsSkeleton } from "@/components/Skeletons";

type ReportData = Awaited<ReturnType<typeof getMonitoringReportData>>;
type SelectedField = {
  id: string | number;
  name: string;
  source: "capdev" | "request";
  key?: string;
};

const TEMPLATE_SECTIONS = [
  {
    title: "CAPDEV PROPOSAL (To be filled out by HRDO)",
    color: "#fff2cc",
    fields: ["DOC. NO.", "SOURCE OF BUDGET"],
  },
  {
    title: "I. LBP FORM 4 DETAILS (To be filled out by OFFICES)",
    color: "#47d45a",
    fields: ["SECTOR", "OFFICE", "AIP REFERENCE CODE", "ACTIVITY"],
  },
  {
    title: "II. ACTIVITY DESIGN DETAILS (To be filled out by OFFICES)",
    color: "#47d45a",
    fields: [
      "CURRENT STATE",
      "DESIRED STATE",
      "MAJOR FINAL OUTPUT",
      "PERFORMANCE / OUTPUT INDICATOR",
      "TARGET FOR THE BUDGET YEAR",
      "TARGET DATE OF COMPLETION",
      "TITLE",
      "VENUE",
      "ACTIVITY CATEGORY",
      "BATCH",
      "FIRST LEVEL (MALE)",
      "FIRST LEVEL (FEMALE)",
      "SECOND LEVEL (MALE)",
      "SECOND LEVEL (FEMALE)",
      "PARTICIPANTS PARTICULARS",
      "IMPLEMENTATION DATE FROM",
    ],
  },
  {
    title:
      "III. BUDGETARY REQUIREMENTS (Fill Color = Obligated/Utilized) (To be filled out by OFFICES)",
    color: "#c1e4f5",
    fields: [
      "IMPLEMENTATION DATE END",
      "RATIONALE",
      "METHODOLOGY",
      "PERFORMANCE OBJECTIVES",
      "LEARNING OBJECTIVES",
      "COURSE CONTENT",
      "LEASE OF VENUE / ACCOMMODATION",
      "CITY-OWNED",
      "SUPPLIES",
      "REGISTRATION FEE",
      "HONORARIUM",
      "TRANSPO EXPENSE",
      "DTE/DSA",
    ],
  },
  {
    title: "IV. DOCUMENT TRACKER DETAILS (To be filled out by OFFICES)",
    color: "#a6c9eb",
    fields: [
      "AIRFARE",
      "FOOD",
      "INCIDENTAL EXPENSE",
      "TOTAL AMOUNT",
      "OBLIGATED",
      "UTILIZED",
      "EXPENSE PER PAX",
      "PRESENT MALE",
      "PRESENT FEMALE",
      "NO. OF ABSENCES",
      "EXPENSE LOSS",
    ],
  },
  {
    title: "V. TERMINAL REPORT DETAILS (To be filled out by OFFICES)",
    color: "#45b0e1",
    fields: [
      "ATTENDANCE BREAKDOWN",
      "OBJECTIVE ACHIEVEMENT RATE",
      "PRE/POST TEST IMPROVEMENT RATE",
      "ATTACH PRE/POST TEST LINK ACCESS",
      "SME EVALUATION",
      "TRAINING EVALUATION",
      "ACTIVITY OBJECTIVES",
    ],
  },
  {
    title: "VI. ATTACHMENT (To be filled out by OFFICES)",
    color: "#4d94d8",
    fields: [
      "SUMMARY OF PARTICIPANTS’ EVALUATION",
      "QUALITATIVE HIGHLIGHTS",
      "LESSONS LEARNED / BEST PRACTICES",
      "ISSUES AND CHALLENGES",
      "RECOMMENDATIONS AND NEXT STEPS",
      "ACTIVITY HIGHLIGHTS",
      "ATTACH ACTIVITY DESIGN",
      "ACTIVITY DESIGN APPROVAL DATE",
      "ATTACH OBR",
      "OBR DATE",
    ],
  },
  {
    title: "HRDO RATING PRE-IMPLEMENTATION",
    color: "#47d45a",
    fields: ["QUALITY", "EFFICIENCY", "TIMELINESS"],
  },
  {
    title: "HRDO RATING DURING-IMPLEMENTATION",
    color: "#47d45a",
    fields: ["QUALITY", "EFFICIENCY", "TIMELINESS"],
  },
  {
    title: "HRDO RATING POST-IMPLEMENTATION",
    color: "#47d45a",
    fields: ["QUALITY", "EFFICIENCY", "TIMELINESS"],
  },
  {
    title: "AVERAGE ACTIVITY RATING",
    color: "#47d45a",
    fields: ["QUALITY", "EFFICIENCY", "TIMELINESS", "TOTAL"],
  },
  { title: "HRDO ANALYSIS", color: "#47d45a", fields: ["ANALYSIS"] },
];
const CAPDEV_FIXED_FIELDS = [
  "AIP Code",
  "Department",
  "Initial Balance",
  "Remaining Balance",
] as const;
const REQUEST_FIXED_FIELDS = [
  "Request Title",
  "Event Date",
  "Setting",
  "Requested Amount",
  "Requestor",
] as const;
const CAPDEV_FIXED_KEYS = ["aipCode", "department", "initialBudget", "budget"];
const REQUEST_FIXED_KEYS = [
  "description",
  "eventDate",
  "setting",
  "requestedBudget",
  "requestorName",
];

const toDateInput = () => manilaDate();
const currentReportDate = manilaDate();
const MONTHS = Array.from({ length: 12 }, (_, index) =>
  new Intl.DateTimeFormat("en-US", { month: "long" }).format(
    new Date(2020, index, 1),
  ),
);

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value))
    return value
      .map((item) =>
        typeof item === "object" && item !== null && "name" in item
          ? String(item.name)
          : String(item),
      )
      .join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  if (value === "internal") return "In-House";
  return String(value);
}

function fieldValue(
  additionalInfo: Record<string, unknown>,
  field: Pick<SelectedField, "id" | "name">,
) {
  return displayValue(
    typeof field.id === "number"
      ? getDynamicFieldValue(additionalInfo, { id: field.id, name: field.name })
      : additionalInfo[field.name],
  );
}

function downloadFile(base64: string, fileName: string, mimeType: string) {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function RequestReportTable({ report }: { report: RequestReportData }) {
  const sections: Array<{
    label: string;
    rows: RequestReportRow[];
    headerColor: string;
  }> = [
    { label: "Completed", rows: report.completed, headerColor: "primary.main" },
    { label: "In Progress", rows: report.inProgress, headerColor: "warning.main" },
    { label: "Rejected", rows: report.rejected, headerColor: "error.main" },
  ];
  const headers = [
    "Request Title",
    "Date of event",
    "Allotted budget",
    "Utilized budget",
    "Evaluation result",
  ];
  return (
    <Box sx={{ bgcolor: "#f4f7f4", p: { xs: 2, md: 3 } }}>
      <Stack
        spacing={0.5}
        sx={{ alignItems: "center", textAlign: "center", mb: 3 }}
      >
        <Typography
          variant="overline"
          color="primary.dark"
          sx={{ fontWeight: 800, letterSpacing: 1.2 }}
        >
          LEAPRS
        </Typography>
        <Typography
          variant="h5"
          sx={{ fontWeight: 800, letterSpacing: "-0.5px" }}
        >
          Request Report
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Report as of {report.label}
        </Typography>
      </Stack>
      <Stack spacing={2.5}>
        {sections.map((section) => (
          <Box
            key={section.label}
            sx={{
              overflow: "hidden",
              bgcolor: "background.paper",
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 2,
            }}
          >
            <Stack
              direction="row"
              sx={{
                alignItems: "center",
                justifyContent: "space-between",
                px: 2,
                py: 1.25,
                bgcolor: section.headerColor,
                color: "primary.contrastText",
              }}
            >
              <Typography sx={{ fontWeight: 800 }}>{section.label}</Typography>
              <Chip
                label={section.rows.length}
                size="small"
                sx={{
                  bgcolor: "rgba(255,255,255,0.18)",
                  color: "inherit",
                  fontWeight: 800,
                }}
              />
            </Stack>
            <TableContainer>
              <Table size="small" sx={{ minWidth: 760 }}>
                <TableHead>
                  <TableRow>
                    {headers.map((header) => (
                      <TableCell
                        key={header}
                        sx={{
                          bgcolor: "rgba(46, 125, 50, 0.08)",
                          color: "primary.dark",
                          fontWeight: 800,
                          borderColor: "divider",
                        }}
                      >
                        {header}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {section.rows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        align="center"
                        sx={{ color: "text.secondary", py: 3 }}
                      >
                        No requests for this period.
                      </TableCell>
                    </TableRow>
                  ) : (
                    section.rows.map((row) => (
                      <TableRow key={row.id} hover>
                        <TableCell sx={{ fontWeight: 700 }}>
                          {row.title}
                        </TableCell>
                        <TableCell>
                          {new Intl.DateTimeFormat("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            timeZone: "UTC",
                          }).format(new Date(`${row.eventDate}T00:00:00Z`))}
                        </TableCell>
                        <TableCell>
                          {new Intl.NumberFormat("en-PH", {
                            style: "currency",
                            currency: "PHP",
                          }).format(Number(row.allottedBudget))}
                        </TableCell>
                        <TableCell>
                          {new Intl.NumberFormat("en-PH", {
                            style: "currency",
                            currency: "PHP",
                          }).format(Number(row.utilizedBudget))}
                        </TableCell>
                        <TableCell>
                          {row.setting === "external" ||
                          row.evaluationAverage === null
                            ? "None"
                            : row.evaluationAverage.toFixed(1)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

export default function ReportsPage() {
  const [reportType, setReportType] = useState<"monitoring" | "requests">(
    "monitoring",
  );
  const [draftReportType, setDraftReportType] = useState<
    "monitoring" | "requests"
  >("monitoring");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [data, setData] = useState<ReportData>({
    capdevs: [],
    requests: [],
    capdevFields: [],
    requestFields: [],
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const [selectedCapdevIds, setSelectedCapdevIds] = useState<number[]>([]);
  const [selectedCapdevFields, setSelectedCapdevFields] = useState<number[]>(
    [],
  );
  const [selectedRequestFields, setSelectedRequestFields] = useState<number[]>(
    [],
  );
  const [selectedCapdevFixedFields, setSelectedCapdevFixedFields] = useState<
    string[]
  >([]);
  const [selectedRequestFixedFields, setSelectedRequestFixedFields] = useState<
    string[]
  >([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [generated, setGenerated] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [requestReportMonth, setRequestReportMonth] = useState(
    Number(currentReportDate.slice(5, 7)),
  );
  const [requestReportYear, setRequestReportYear] = useState(
    Number(currentReportDate.slice(0, 4)),
  );
  const [requestReport, setRequestReport] = useState<RequestReportData | null>(
    null,
  );
  const [requestReportLoading, setRequestReportLoading] = useState(false);
  const reportTableRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    let active = true;
    void readPortal('reports', {}).then((result) => {
      if (!active) return;
      setLoadError('');
      setData(result);
      setSelectedCapdevIds(result.capdevs.map((capdev) => capdev.id));
      setLoading(false);
    }).catch(() => { if (active) { setLoading(false); setLoadError('Unable to load reports. Please try again.'); } });
    return () => { active = false; };
  }, [retry]);

  const visibleCapdevs = useMemo(
    () =>
      data.capdevs.filter((capdev) => {
        const createdAt = new Date(capdev.createdAt).getTime();
        return (
          (!dateFrom || createdAt >= manilaDateBoundary(dateFrom).getTime()) &&
          (!dateTo || createdAt <= manilaDateBoundary(dateTo, true).getTime())
        );
      }),
    [data.capdevs, dateFrom, dateTo],
  );
  const visibleIds = useMemo(
    () => new Set(visibleCapdevs.map((capdev) => capdev.id)),
    [visibleCapdevs],
  );
  const selectedCapdevs = data.capdevs.filter(
    (capdev) =>
      selectedCapdevIds.includes(capdev.id) && visibleIds.has(capdev.id),
  );
  const selectedCapdevFieldDefinitions = data.capdevFields.filter((field) =>
    selectedCapdevFields.includes(field.id),
  );
  const selectedRequestFieldDefinitions = data.requestFields.filter((field) =>
    selectedRequestFields.includes(field.id),
  );
  const selectedMonitoringFields: SelectedField[] = [
    ...CAPDEV_FIXED_FIELDS.flatMap((name, index) =>
      selectedCapdevFixedFields.includes(CAPDEV_FIXED_KEYS[index])
        ? [
            {
              id: `capdev-fixed-${index}`,
              name,
              source: "capdev" as const,
              key: CAPDEV_FIXED_KEYS[index],
            },
          ]
        : [],
    ),
    ...selectedCapdevFieldDefinitions.map((field) => ({
      id: field.id,
      name: field.name,
      source: "capdev" as const,
    })),
    ...REQUEST_FIXED_FIELDS.flatMap((name, index) =>
      selectedRequestFixedFields.includes(REQUEST_FIXED_KEYS[index])
        ? [
            {
              id: `request-fixed-${index}`,
              name,
              source: "request" as const,
              key: REQUEST_FIXED_KEYS[index],
            },
          ]
        : [],
    ),
    ...selectedRequestFieldDefinitions.map((field) => ({
      id: field.id,
      name: field.name,
      source: "request" as const,
    })),
  ];
  const reportRows = data.requests.filter((request) =>
    selectedCapdevs.some((capdev) => capdev.id === request.capdevId),
  );
  const capdevColumnCount = Math.max(1, selectedMonitoringFields.length);

  const setQuickDate = (range: "today" | "month" | "year") => {
    const dateTo = toDateInput();
    setDateFrom(
      range === "today"
        ? dateTo
        : range === "month"
          ? dateTo.slice(0, 7) + "-01"
          : dateTo.slice(0, 4) + "-01-01",
    );
    setDateTo(dateTo);
  };
  const toggleCapdev = (id: number) =>
    setSelectedCapdevIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  const toggleField = (
    id: number,
    setSelected: React.Dispatch<React.SetStateAction<number[]>>,
  ) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  const exportExcel = async () => {
    setGenerating(true);
    const result = await generateMonitoringSheet({
      capdevIds: selectedCapdevs.map((capdev) => capdev.id),
      capdevFieldIds: selectedCapdevFields,
      requestFieldIds: selectedRequestFields,
      capdevFixedFields: selectedCapdevFixedFields,
      requestFixedFields: selectedRequestFixedFields,
    });
    if (
      result.success &&
      "base64" in result &&
      result.base64 &&
      result.fileName
    )
      downloadFile(
        result.base64,
        result.fileName,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
    setGenerating(false);
  };
  const buildRequestReport = async () => {
    setRequestReportLoading(true);
    const result = await getRequestReportData(
      requestReportMonth,
      requestReportYear,
    );
    setRequestReport(result.success ? result : null);
    setRequestReportLoading(false);
  };
  const exportRequestReport = async () => {
    setGenerating(true);
    const result = await generateRequestReportPdf(
      requestReportMonth,
      requestReportYear,
    );
    if (
      result.success &&
      "base64" in result &&
      result.base64 &&
      result.fileName
    )
      downloadFile(result.base64, result.fileName, "application/pdf");
    setGenerating(false);
  };

  if (loadError) return <Alert severity="error">{loadError}<Button onClick={() => setRetry(value => value + 1)}>Retry</Button></Alert>;
  if (loading) return <ReportsSkeleton />;

  return (
    <Box sx={{ minHeight: "calc(100vh - 72px)" }}>
      <style>{`.monitoring-preview tr:nth-child(1) td:not(:first-child) { background: #ffffff !important; } .monitoring-preview tr:nth-child(2) td:nth-child(2) { background: #fff2cc !important; } .monitoring-preview tr:nth-child(3) td { background: #a4c2f4 !important; } .monitoring-preview tr:nth-child(n + 4) td { background: #ffffff !important; }`}</style>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{
          alignItems: { sm: "center" },
          justifyContent: "space-between",
          mb: 3,
        }}
      >
        <Typography
          variant="h4"
          sx={{ fontWeight: 800, letterSpacing: "-1px" }}
        >
          Reports
        </Typography>
        <Button
          size="small"
          sx={{ height: 40, alignSelf: { xs: "flex-start", sm: "auto" } }}
          variant="outlined"
          startIcon={<FilterIcon />}
          onClick={() => {
            setDraftReportType(reportType);
            setFiltersOpen(true);
          }}
        >
          Filter
        </Button>
      </Stack>
      <Grid container spacing={3}>
        <Grid size={12}>
          {reportType === "monitoring" ? (
            <Card
              variant="outlined"
              sx={{ borderRadius: 2, bgcolor: "#fafcfa" }}
            >
              <CardContent
                sx={{
                  p: { xs: 2.5, md: 3 },
                  "&:last-child": { pb: { xs: 2.5, md: 3 } },
                }}
              >
                <Stack spacing={3}>
                  <Stack
                    direction="row"
                    spacing={1.5}
                    sx={{ alignItems: "center" }}
                  >
                    <Box
                      sx={{
                        display: "grid",
                        placeItems: "center",
                        width: 42,
                        height: 42,
                        borderRadius: 2,
                        bgcolor: "rgba(46, 125, 50, 0.10)",
                        color: "primary.main",
                      }}
                    >
                      <ReportIcon />
                    </Box>
                    <Typography variant="h6" sx={{ fontWeight: 800 }}>
                      Monitoring Sheet
                    </Typography>
                  </Stack>
                  <Divider />
                  <Box>
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      sx={{
                        justifyContent: "space-between",
                        alignItems: { sm: "center" },
                        mb: 1,
                      }}
                    >
                      <Typography sx={{ fontWeight: 800 }}>
                        CapDev
                      </Typography>
                      <Stack direction="row" spacing={1}>
                        <Button
                          size="small"
                          startIcon={<SelectAllIcon />}
                          onClick={() =>
                            setSelectedCapdevIds(
                              visibleCapdevs.map((capdev) => capdev.id),
                            )
                          }
                        >
                          Select All
                        </Button>
                        <Button
                          size="small"
                          onClick={() => setSelectedCapdevIds([])}
                        >
                          Clear
                        </Button>
                      </Stack>
                    </Stack>
                    <Grid container spacing={1}>
                      {visibleCapdevs.map((capdev) => (
                        <Grid key={capdev.id} size={{ xs: 12, sm: 6 }}>
                          <FormControlLabel
                            control={
                              <Checkbox
                                checked={selectedCapdevIds.includes(capdev.id)}
                                onChange={() => toggleCapdev(capdev.id)}
                              />
                            }
                            label={
                              <Stack>
                                <Typography
                                  variant="body2"
                                  sx={{ fontWeight: 700 }}
                                >
                                  {capdev.aipCode}
                                </Typography>
                                {capdev.department &&
                                  capdev.department !== "None" && (
                                    <Typography
                                      variant="caption"
                                      color="text.secondary"
                                    >
                                      {capdev.department}
                                    </Typography>
                                  )}
                              </Stack>
                            }
                            sx={{
                              m: 0,
                              p: 1,
                              width: "100%",
                              alignItems: "center",
                              border: "1px solid",
                              borderColor: selectedCapdevIds.includes(capdev.id)
                                ? "primary.main"
                                : "divider",
                              borderRadius: 2,
                              bgcolor: selectedCapdevIds.includes(capdev.id)
                                ? "rgba(46, 125, 50, 0.05)"
                                : "transparent",
                            }}
                          />
                        </Grid>
                      ))}
                    </Grid>
                    {visibleCapdevs.length === 0 && (
                      <Typography color="text.secondary" sx={{ py: 2 }}>
                        No CapDev match the date filter.
                      </Typography>
                    )}
                  </Box>
                  <Box>
                    <Typography sx={{ fontWeight: 800, mb: 1 }}>
                      Added date
                    </Typography>
                    <Grid container spacing={1.5} sx={{ alignItems: "center" }}>
                      <Grid size={{ xs: 12, sm: 4 }}>
                        <DateField
                          size="small"
                          label="From"
                          value={dateFrom}
                          onChange={setDateFrom}
                        />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 4 }}>
                        <DateField
                          size="small"
                          label="To"
                          value={dateTo}
                          onChange={setDateTo}
                        />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 4 }}>
                        <Stack
                          direction="row"
                          spacing={0.5}
                          sx={{
                            height: "100%",
                            alignItems: "center",
                            flexWrap: "wrap",
                          }}
                        >
                          {(["today", "month", "year"] as const).map(
                            (range) => (
                              <Button
                                key={range}
                                size="small"
                                onClick={() => setQuickDate(range)}
                              >
                                {range === "today"
                                  ? "Today"
                                  : range === "month"
                                    ? "This month"
                                    : "This year"}
                              </Button>
                            ),
                          )}
                          <Button
                            size="small"
                            startIcon={<ResetIcon />}
                            onClick={() => {
                              setDateFrom("");
                              setDateTo("");
                            }}
                          >
                            Reset
                          </Button>
                        </Stack>
                      </Grid>
                    </Grid>
                  </Box>
                  <Grid container spacing={3}>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <Typography sx={{ fontWeight: 800, mb: 1 }}>
                        CapDev fields
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Core fields
                      </Typography>
                      {CAPDEV_FIXED_FIELDS.map((field, index) => (
                        <FormControlLabel
                          key={field}
                          control={
                            <Checkbox
                              checked={selectedCapdevFixedFields.includes(
                                CAPDEV_FIXED_KEYS[index],
                              )}
                              onChange={() =>
                                setSelectedCapdevFixedFields((current) =>
                                  current.includes(CAPDEV_FIXED_KEYS[index])
                                    ? current.filter(
                                        (key) =>
                                          key !== CAPDEV_FIXED_KEYS[index],
                                      )
                                    : [...current, CAPDEV_FIXED_KEYS[index]],
                                )
                              }
                            />
                          }
                          label={field}
                          sx={{ display: "flex", width: "fit-content" }}
                        />
                      ))}
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block", mt: 1 }}
                      >
                        Configured fields
                      </Typography>
                      {data.capdevFields.map((field) => (
                        <FormControlLabel
                          key={field.id}
                          control={
                            <Checkbox
                              checked={selectedCapdevFields.includes(field.id)}
                              onChange={() =>
                                toggleField(field.id, setSelectedCapdevFields)
                              }
                            />
                          }
                          label={field.name}
                          sx={{ display: "flex", width: "fit-content" }}
                        />
                      ))}
                    </Grid>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <Typography sx={{ fontWeight: 800, mb: 1 }}>
                        Request fields
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Core fields
                      </Typography>
                      {REQUEST_FIXED_FIELDS.map((field, index) => (
                        <FormControlLabel
                          key={field}
                          control={
                            <Checkbox
                              checked={selectedRequestFixedFields.includes(
                                REQUEST_FIXED_KEYS[index],
                              )}
                              onChange={() =>
                                setSelectedRequestFixedFields((current) =>
                                  current.includes(REQUEST_FIXED_KEYS[index])
                                    ? current.filter(
                                        (key) =>
                                          key !== REQUEST_FIXED_KEYS[index],
                                      )
                                    : [...current, REQUEST_FIXED_KEYS[index]],
                                )
                              }
                            />
                          }
                          label={field}
                          sx={{ display: "flex", width: "fit-content" }}
                        />
                      ))}
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block", mt: 1 }}
                      >
                        Configured fields
                      </Typography>
                      {data.requestFields.map((field) => (
                        <FormControlLabel
                          key={field.id}
                          control={
                            <Checkbox
                              checked={selectedRequestFields.includes(field.id)}
                              onChange={() =>
                                toggleField(field.id, setSelectedRequestFields)
                              }
                            />
                          }
                          label={field.name}
                          sx={{ display: "flex", width: "fit-content" }}
                        />
                      ))}
                    </Grid>
                  </Grid>
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={1.5}
                    sx={{ justifyContent: "flex-end", pt: 1 }}
                  >
                    <Button
                      variant="outlined"
                      startIcon={<FilterIcon />}
                      onClick={() => {
                        setSelectedCapdevIds(
                          visibleCapdevs.map((capdev) => capdev.id),
                        );
                        setSelectedCapdevFields([]);
                        setSelectedRequestFields([]);
                        setSelectedCapdevFixedFields([]);
                        setSelectedRequestFixedFields([]);
                        setGenerated(false);
                      }}
                    >
                      Reset selection
                    </Button>
                    <Button
                      variant="contained"
                      onClick={() => setGenerated(true)}
                      disabled={selectedCapdevs.length === 0}
                    >
                      Generate report
                    </Button>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          ) : (
            <Card
              variant="outlined"
              sx={{ borderRadius: 2, bgcolor: "#fafcfa" }}
            >
              <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
                <Stack spacing={3}>
                  <Stack
                    direction="row"
                    spacing={1.5}
                    sx={{ alignItems: "center" }}
                  >
                    <Box
                      sx={{
                        display: "grid",
                        placeItems: "center",
                        width: 42,
                        height: 42,
                        borderRadius: 2,
                        bgcolor: "rgba(46, 125, 50, 0.10)",
                        color: "primary.main",
                      }}
                    >
                      <RequestReportIcon />
                    </Box>
                    <Typography variant="h6" sx={{ fontWeight: 800 }}>
                      Request Report
                    </Typography>
                  </Stack>
                  <Divider />
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        select
                        fullWidth
                        label="Month"
                        value={requestReportMonth}
                        onChange={(event) => {
                          setRequestReportMonth(Number(event.target.value));
                          setRequestReport(null);
                        }}
                      >
                        {MONTHS.map((month, index) => (
                          <MenuItem key={month} value={index + 1}>
                            {month}
                          </MenuItem>
                        ))}
                      </TextField>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        select
                        fullWidth
                        label="Year"
                        value={requestReportYear}
                        onChange={(event) => {
                          setRequestReportYear(Number(event.target.value));
                          setRequestReport(null);
                        }}
                      >
                        {Array.from(
                          { length: 11 },
                          (_, index) =>
                            Number(currentReportDate.slice(0, 4)) - 5 + index,
                        ).map((year) => (
                          <MenuItem key={year} value={year}>
                            {year}
                          </MenuItem>
                        ))}
                      </TextField>
                    </Grid>
                  </Grid>
                  <Stack direction="row" sx={{ justifyContent: "flex-end" }}>
                    <Button
                      variant="contained"
                      onClick={() => void buildRequestReport()}
                      disabled={requestReportLoading}
                    >
                      {requestReportLoading
                        ? "Generating..."
                        : "Generate report"}
                    </Button>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          )}
        </Grid>
        {reportType === "monitoring" && generated && (
          <Grid size={12}>
            <Card
              variant="outlined"
              sx={{ borderRadius: 2, overflow: "hidden", bgcolor: "#fafcfa" }}
            >
              <CardContent sx={{ p: 0, "&:last-child": { pb: 0 } }}>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1.5}
                  sx={{
                    justifyContent: "space-between",
                    alignItems: "center",
                    p: 2,
                    borderBottom: "1px solid",
                    borderColor: "divider",
                  }}
                >
                  <Typography sx={{ fontWeight: 800 }}>
                    Monitoring Sheet preview
                  </Typography>
                  <Button
                    variant="contained"
                    startIcon={<DownloadIcon />}
                    onClick={exportExcel}
                    disabled={generating}
                  >
                    {generating ? "Generating..." : "Download Excel"}
                  </Button>
                </Stack>
                <Box sx={{ overflowX: "auto" }}>
                  <table
                    className="monitoring-preview"
                    ref={reportTableRef}
                    style={{
                      width: "max-content",
                      minWidth: "100%",
                      borderCollapse: "collapse",
                      fontFamily: "Arial, sans-serif",
                      fontSize: 12,
                    }}
                  >
                    <tbody>
                      <tr>
                        <td style={{ width: 18 }} />
                        <td
                          colSpan={
                            capdevColumnCount +
                            TEMPLATE_SECTIONS.reduce(
                              (total, section) => total + section.fields.length,
                              0,
                            )
                          }
                          style={{
                            height: 30,
                            padding: "8px 16px",
                            fontWeight: 700,
                            fontSize: 15,
                            background: "#47d45a",
                            border: "1px solid #999",
                            textAlign: "center",
                          }}
                        >
                          {new Date().getFullYear()} CONSOLIDATED
                          COMPETENCY-BASED LEARNING & DEVELOPMENT INTERVENTIONS
                          (CapDev)
                        </td>
                      </tr>
                      <tr>
                        <td />
                        <td
                          colSpan={capdevColumnCount}
                          style={{
                            padding: "8px 12px",
                            fontWeight: 700,
                            background: "#47d45a",
                            border: "1px solid #999",
                            textAlign: "center",
                          }}
                        >
                          CAPACITY DEVELOPMENT
                        </td>
                        {TEMPLATE_SECTIONS.map((section) => (
                          <td
                            key={section.title}
                            colSpan={section.fields.length}
                            style={{
                              padding: "8px 12px",
                              fontWeight: 700,
                              background: "#47d45a",
                              border: "1px solid #999",
                              textAlign: "center",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {section.title}
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td />
                        {selectedMonitoringFields.length > 0 ? (
                          selectedMonitoringFields.map((field) => (
                            <td
                              key={`${field.source}-${field.id}`}
                              style={{
                                height: 45,
                                padding: "8px 10px",
                                fontWeight: 700,
                                background: "#47d45a",
                                border: "1px solid #999",
                                minWidth: 150,
                                textAlign: "center",
                              }}
                            >
                              {field.name}
                            </td>
                          ))
                        ) : (
                          <td
                            style={{
                              height: 45,
                              padding: "8px 10px",
                              background: "#47d45a",
                              border: "1px solid #999",
                              minWidth: 150,
                            }}
                          />
                        )}
                        {TEMPLATE_SECTIONS.flatMap((section) =>
                          section.fields.map((field) => (
                            <td
                              key={`${section.title}-${field}`}
                              style={{
                                height: 45,
                                padding: "8px 10px",
                                fontWeight: 700,
                                background: "#47d45a",
                                border: "1px solid #999",
                                minWidth: 130,
                                textAlign: "center",
                              }}
                            >
                              {field}
                            </td>
                          )),
                        )}
                      </tr>
                      {reportRows.map((request) => {
                        const capdev = selectedCapdevs.find(
                          (item) => item.id === request.capdevId,
                        );
                        const capdevInfo = (capdev?.additionalInfo ||
                          {}) as Record<string, unknown>;
                        const requestInfo = (request.additionalInfo ||
                          {}) as Record<string, unknown>;
                        const capdevRecord = (capdev || {}) as Record<
                          string,
                          unknown
                        >;
                        const requestRecord = request as unknown as Record<
                          string,
                          unknown
                        >;
                        return (
                          <tr key={request.id}>
                            <td />
                            {selectedMonitoringFields.length > 0 ? (
                              selectedMonitoringFields.map((field) => (
                                <td
                                  key={`${field.source}-${field.id}`}
                                  style={{
                                    padding: "8px 10px",
                                    border: "1px solid #999",
                                    verticalAlign: "top",
                                    background: "#47d45a",
                                  }}
                                >
                                  {field.key
                                    ? displayValue(
                                        (field.source === "capdev"
                                          ? capdevRecord
                                          : requestRecord)[field.key],
                                      )
                                    : fieldValue(
                                        field.source === "capdev"
                                          ? capdevInfo
                                          : requestInfo,
                                        field,
                                      )}
                                </td>
                              ))
                            ) : (
                              <td
                                style={{
                                  padding: "8px 10px",
                                  border: "1px solid #999",
                                  background: "#47d45a",
                                }}
                              />
                            )}
                            {TEMPLATE_SECTIONS.flatMap((section) =>
                              section.fields.map((field) => (
                                <td
                                  key={`${request.id}-${section.title}-${field}`}
                                  style={{
                                    padding: "8px 10px",
                                    border: "1px solid #999",
                                    minWidth: 130,
                                    background: "#47d45a",
                                  }}
                                />
                              )),
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {reportRows.length === 0 && (
                    <Box sx={{ p: 3, textAlign: "center" }}>
                      <Typography color="text.secondary">
                        No requests found for the selected CapDev.
                      </Typography>
                    </Box>
                  )}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        )}
        {reportType === "requests" && requestReport && (
          <Grid size={12}>
            <Card
              variant="outlined"
              sx={{ borderRadius: 2, overflow: "hidden", bgcolor: "#fafcfa" }}
            >
              <CardContent sx={{ p: 0, "&:last-child": { pb: 0 } }}>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1.5}
                  sx={{
                    justifyContent: "space-between",
                    alignItems: "center",
                    p: 2,
                    borderBottom: "1px solid",
                    borderColor: "divider",
                  }}
                >
                  <Typography sx={{ fontWeight: 800 }}>
                    Request Report preview
                  </Typography>
                  <Button
                    variant="contained"
                    startIcon={<DownloadIcon />}
                    onClick={() => void exportRequestReport()}
                    disabled={generating}
                  >
                    {generating ? "Generating..." : "Download PDF"}
                  </Button>
                </Stack>
                <RequestReportTable report={requestReport} />
              </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>
      <Dialog
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 800 }}>Filter Reports</DialogTitle>
        <DialogContent dividers>
          <TextField
            select
            fullWidth
            label="Report type"
            value={draftReportType}
            onChange={(event) =>
              setDraftReportType(
                event.target.value as "monitoring" | "requests",
              )
            }
          >
            <MenuItem value="monitoring">Monitoring Sheet</MenuItem>
            <MenuItem value="requests">Request Reports</MenuItem>
          </TextField>
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={() => setDraftReportType("monitoring")}>
            Reset
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              setReportType(draftReportType);
              setFiltersOpen(false);
            }}
          >
            Apply Filters
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
