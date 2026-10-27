// A deliberately messy sponsor sheet for the import demo: a header with a trailing space, quoted
// commas, a quoted note that spans two lines, blank and all-empty rows, stray spaces around values,
// four rows that fail validation, and two groups of look-alikes.
//
// Against the main demo workspace (boiler-robotics) the preview reports:
//   17 rows found, 4 that will not import (rows 10, 11, 12 and 17), and 2 duplicate groups.
//   Group one: row 2 ("Cummins, Inc.") matches the Cummins Inc. already in the workspace.
//   Group two: rows 3 and 4 are the same company twice, inside the file.
//   Suggested choices skip rows 2 and 4, so 11 companies are imported.

export const SAMPLE_CSV_FILENAME = "sponsor-leads-fall-2026.csv";

export const SAMPLE_CSV = `Company Name ,Industry,Website,Contact,Contact Email,Notes
"Cummins, Inc.",Engines,https://www.cummins.com/,Dana Reyes,dana.reyes@cummins.example,"Met at the fall career fair, wants the packet"
  Duke Energy  , Utilities , duke-energy.com ,  Omar Haddad ,  omar.haddad@duke-energy.example  ,  stray spaces everywhere
DUKE ENERGY CORP.,Utilities,https://www.duke-energy.com/home,,,Second entry from the alumni list
Hoosier Energy,Utilities,hoosierenergy.com,,,
"Barnes & Thornburg, LLP",Legal,btlaw.com,,,"Indianapolis firm, interested in tech clubs"
Berry Global,Packaging,berryglobal.com,Tom Nguyen,tom.nguyen@berryglobal.example,Evansville headquarters

Haynes International,Metals,haynesintl.com,,,
,Finance,nameless.com,,,No company name
Bad Site LLC,,not a website,,,
Bad Email Inc,,,Pat Lee,pat at example,
Emmis Communications,Media,emmis.com,,,"Local radio group
Offers in-kind ad space"
Wabash National,Transportation,wabashnational.com,Lena Fischer,lena.fischer@wabashnational.example,Lafayette headquarters. Alumni on staff
,,,,,
Beacon Credit Union,Finance,beaconcu.org,Nadia Petrov,nadia.petrov@beaconcu.example,Lafayette based
Tippecanoe Tech Partners,Technology,tippecanoetech.com,,ops@tippecanoetech.example,Email only with no contact name
Wabash Valley Power,Utilities,wvpa.com,,,
Kirby Risk,Electrical distribution,kirbyrisk.com,Jess Albright,jess.albright@kirbyrisk.example,Family owned. Sponsors local robotics teams
Wabtec,Rail technology,wabtec.com,,,
`;
