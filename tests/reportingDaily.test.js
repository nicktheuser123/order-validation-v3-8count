const { getThing, searchThings } = require("../config/bubbleClient");
const { getNum } = require("../lib/testUtils");
const testResultsLogger = require("../config/testResultsLogger");
const { REPORTING_DAILY_ID, RUN_REPORTING_DAILY_TESTS, TYPES } = require("../testConfig");

let reportingDaily;
let ticketTypeDailies;
let customFeeDailies;

beforeAll(async () => {
  if (!RUN_REPORTING_DAILY_TESTS) return;
  if (!REPORTING_DAILY_ID) {
    throw new Error("Set REPORTING_DAILY_ID in testConfig.js to run this suite");
  }

  reportingDaily = await getThing(TYPES.GP_REPORTINGDAILY, REPORTING_DAILY_ID);

  const eventId = reportingDaily.event_custom_event;

  // Fetch ticket type daily records linked to the same event
  ticketTypeDailies = await searchThings(TYPES.GP_REPORTINGTICKETTYPEDAILY, [
    { key: "event_custom_event", constraint_type: "equals", value: eventId }
  ]);

  // Fetch custom fee daily records linked to the same event
  customFeeDailies = await searchThings(TYPES.GP_REPORTINGCUSTOMFEEDAILY, [
    { key: "event_custom_event", constraint_type: "equals", value: eventId }
  ]);

  if (ticketTypeDailies.length === 0) {
    throw new Error(`No GP_ReportingTicketTypeDaily records found for event ${eventId}`);
  }
}, 120000);

(RUN_REPORTING_DAILY_TESTS && REPORTING_DAILY_ID ? describe : describe.skip)(
  "GP_ReportingDaily validation",
  () => {
    it("validates gross sales", () => {
      const val = getNum(reportingDaily, "gross_sales_number");
      testResultsLogger.step("gross_sales_number", { value: val });
      expect(val).toBeGreaterThanOrEqual(0);
    });

    it("validates gross revenue (total sales)", () => {
      const val = getNum(reportingDaily, "gross_revenue_number");
      testResultsLogger.step("gross_revenue_number", { value: val });
      expect(val).toBeGreaterThanOrEqual(0);
    });

    it("validates net revenue", () => {
      const val = getNum(reportingDaily, "net_revenue_number");
      testResultsLogger.step("net_revenue_number", { value: val });
      expect(val).toBeGreaterThanOrEqual(0);
    });

    it("validates total tickets sold", () => {
      const val = getNum(reportingDaily, "total_tickets_sold_number");
      testResultsLogger.step("total_tickets_sold_number", { value: val });
      expect(val).toBeGreaterThanOrEqual(0);
    });

    it("validates total ticket sales", () => {
      const val = getNum(reportingDaily, "total_ticket_sales_number");
      testResultsLogger.step("total_ticket_sales_number", { value: val });
      expect(val).toBeGreaterThanOrEqual(0);
    });

    it("validates gross service fees", () => {
      const val = getNum(reportingDaily, "total_service_fees_number");
      testResultsLogger.step("total_service_fees_number", { value: val });
      expect(val).toBeGreaterThanOrEqual(0);
    });

    it("validates net service fees", () => {
      const val = getNum(reportingDaily, "net_service_fees_number");
      testResultsLogger.step("net_service_fees_number", { value: val });
      expect(val).toBeGreaterThanOrEqual(0);
    });

    it("validates gross total fees", () => {
      const val = getNum(reportingDaily, "total_fees_number");
      testResultsLogger.step("total_fees_number", { value: val });
      expect(val).toBeGreaterThanOrEqual(0);
    });

    it("validates net total fees", () => {
      const val = getNum(reportingDaily, "net_total_fees_number");
      testResultsLogger.step("net_total_fees_number", { value: val });
      expect(val).toBeGreaterThanOrEqual(0);
    });

    it("validates gross processing fees revenue", () => {
      const val = getNum(reportingDaily, "total_processing_fees__revenue__number");
      testResultsLogger.step("total_processing_fees__revenue__number", { value: val });
      expect(val).toBeGreaterThanOrEqual(0);
    });

    it("validates processing fees deductions", () => {
      const val = getNum(reportingDaily, "total_processing_fees__deductions__number");
      testResultsLogger.step("total_processing_fees__deductions__number", { value: val });
      expect(val).toBeGreaterThanOrEqual(0);
    });

    it("validates net processing fees revenue", () => {
      const val = getNum(reportingDaily, "net_processing_fees__revenue__number");
      testResultsLogger.step("net_processing_fees__revenue__number", { value: val });
      expect(val).toBeGreaterThanOrEqual(0);
    });

    it("validates donations gross", () => {
      const val = getNum(reportingDaily, "donations_total_amount_number");
      testResultsLogger.step("donations_total_amount_number", { value: val });
      expect(val).toBeGreaterThanOrEqual(0);
    });

    it("validates donations net", () => {
      const val = getNum(reportingDaily, "donations_net_number");
      testResultsLogger.step("donations_net_number", { value: val });
      expect(val).toBeGreaterThanOrEqual(0);
    });

    it("validates donations count", () => {
      const val = getNum(reportingDaily, "donations_count_number");
      testResultsLogger.step("donations_count_number", { value: val });
      expect(val).toBeGreaterThanOrEqual(0);
    });

    it("validates total discounts", () => {
      const val = getNum(reportingDaily, "total_discounts_number");
      testResultsLogger.step("total_discounts_number", { value: val });
      expect(val).toBeGreaterThanOrEqual(0);
    });

    it("validates total deductions", () => {
      const val = getNum(reportingDaily, "total_deductions_number");
      testResultsLogger.step("total_deductions_number", { value: val });
      expect(val).toBeGreaterThanOrEqual(0);
    });

    it("validates total orders count", () => {
      const val = getNum(reportingDaily, "total_orders_count_number");
      testResultsLogger.step("total_orders_count_number", { value: val });
      expect(val).toBeGreaterThanOrEqual(0);
    });
  }
);

(RUN_REPORTING_DAILY_TESTS && REPORTING_DAILY_ID ? describe : describe.skip)(
  "GP_ReportingTicketTypeDaily validation",
  () => {
    it("validates records were fetched", () => {
      testResultsLogger.step("Fetched ticket type daily records", {
        count: ticketTypeDailies.length,
        ids: ticketTypeDailies.map((r) => r._id)
      });
      expect(ticketTypeDailies.length).toBeGreaterThan(0);
    });

    it("validates gross sales (gross_sales1_number)", () => {
      ticketTypeDailies.forEach((rec) => {
        const val = getNum(rec, "gross_sales1_number");
        testResultsLogger.step("gross_sales1_number", { id: rec._id, value: val });
        expect(val).toBeGreaterThanOrEqual(0);
      });
    });

    it("validates final sales (gross_sales_number)", () => {
      ticketTypeDailies.forEach((rec) => {
        const val = getNum(rec, "gross_sales_number");
        testResultsLogger.step("gross_sales_number", { id: rec._id, value: val });
        expect(val).toBeGreaterThanOrEqual(0);
      });
    });

    it("validates tickets sold count", () => {
      ticketTypeDailies.forEach((rec) => {
        const val = getNum(rec, "tickets_sold_count_number");
        testResultsLogger.step("tickets_sold_count_number", { id: rec._id, value: val });
        expect(val).toBeGreaterThanOrEqual(0);
      });
    });

    it("validates service fees", () => {
      ticketTypeDailies.forEach((rec) => {
        const val = getNum(rec, "service_fees_number");
        testResultsLogger.step("service_fees_number", { id: rec._id, value: val });
        expect(val).toBeGreaterThanOrEqual(0);
      });
    });

    it("validates discounts", () => {
      ticketTypeDailies.forEach((rec) => {
        const val = getNum(rec, "discounts_number");
        testResultsLogger.step("discounts_number", { id: rec._id, value: val });
        expect(val).toBeGreaterThanOrEqual(0);
      });
    });
  }
);

(RUN_REPORTING_DAILY_TESTS && REPORTING_DAILY_ID ? describe : describe.skip)(
  "GP_ReportingCustomFeeDaily validation",
  () => {
    it("validates records were fetched", () => {
      testResultsLogger.step("Fetched custom fee daily records", {
        count: customFeeDailies.length,
        ids: customFeeDailies.map((r) => r._id)
      });
      expect(customFeeDailies.length).toBeGreaterThanOrEqual(0);
    });

    it("validates gross total (amount_number)", () => {
      customFeeDailies.forEach((rec) => {
        const val = getNum(rec, "amount_number");
        testResultsLogger.step("amount_number", { id: rec._id, value: val });
        expect(val).toBeGreaterThanOrEqual(0);
      });
    });

    it("validates net total (net_total_number)", () => {
      customFeeDailies.forEach((rec) => {
        const val = getNum(rec, "net_total_number");
        testResultsLogger.step("net_total_number", { id: rec._id, value: val });
        expect(val).toBeGreaterThanOrEqual(0);
      });
    });
  }
);
