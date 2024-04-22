import { v4 } from "uuid";
import getMysql from "./mysql.server";
import { employees, employeesHistory } from "data/schema";
import { z } from "zod";
import { EC2 } from "@aws-sdk/client-ec2";

const ec2 = new EC2({});
const UBUNTU_SERVER_20_04_LTS = "ami-08116b9957a259459";

const createUserSchema = z.object({
  name: z
    .string()
    .array()
    .refine((names) => names.length > 0)
    .transform((names) => names[0]),
  title: z
    .string()
    .array()
    .refine((titles) => titles.length > 0)
    .transform((titles) => titles[0]),
});

const createUserEmployee = async ({
  requestId,
  data,
  userId,
}: {
  requestId: string;
  data: Record<string, string[]>;
  userId: string;
}) => {
  const cxn = await getMysql(requestId);

  const formData = createUserSchema.parse(data);
  const uuid = v4();
  const hiredDate = new Date();

  await ec2.runInstances({
    ImageId: UBUNTU_SERVER_20_04_LTS,
    DryRun: true,
    MaxCount: 1,
    MinCount: 1,
  });

  await cxn.insert(employees).values({
    uuid,
    name: formData.name,
    title: formData.title,
    userId,
    hiredDate,
  });

  await cxn.insert(employeesHistory).values({
    uuid,
    name: formData.name,
    title: formData.title,
    userId,
    hiredDate,
    historyUser: userId,
    historyDate: hiredDate,
  });

  await cxn.end();
  return { employeeUuid: uuid };
};

export default createUserEmployee;
