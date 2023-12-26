const Expense = require("../models/Expense");
const Group = require("../models/Group");
const { BadRequestError, NotFoundError } = require("../errors");
const { default: mongoose } = require("mongoose");

const getAllExpenseInGroup = async (req, res) => {
  const { page, sortBy } = await req.query;
  const { groupID } = await req.params;
  const { userID } = await req.body.user;
  const pageQuery = Number(page) || 1;
  const limitQuery = 10;
  const skipBy = (pageQuery - 1) * limitQuery;
  const sortByQuery = sortBy ? sortBy : "-dateAdded";
  const group = await Group.find({
    _id: groupID,
    members: { $in: [userID] },
  });
  if (group) {
    const expenses = await Expense.find({ grp_id: groupID })
      .sort(sortByQuery)
      .skip(skipBy)
      .limit(limitQuery);
    if (expenses) {
      res.status(200).json({ success: true, expenses });
    } else {
      res.status(404).json({
        success: false,
        msg: "Unable to fetch all expenses in group at this time, please try again later.",
      });
    }
  } else {
    res.status(500).json({
      success: false,
      msg: "You are not authorized to access the expenses of this group.",
    });
  }
};

const getAllExpenseInGroupWithoutFilters = async (req, res) => {
  const { groupID } = await req.params;
  const expenses = await Expense.find({ grp_id: groupID });
  if (expenses) {
    res.status(200).json({ success: true, expenses });
  } else {
    res.status(404).json({
      success: false,
      msg: "Unable to fetch all expenses in group at this time, please try again later.",
    });
  }
};

// MATCH (userA:User {userID: 'userID_A', groupID: 'groupID_A'})
// MATCH (userB:User {userID: 'userID_B', groupID: 'groupID_B'})
// MERGE (userA)-[owes:OWES]->(userB)
// SET owes.amount = 100  // Replace 100 with the actual owed amount
// Check for sum of borrowing and lending list to be same

const addNewExpense = async (req, res) => {
  let { name, amount, borrowingList, lenderList, categoryName, user } =
    await req.body;
  const { groupID } = await req.params;
  const { userID } = await user;
  if (
    !name ||
    !userID ||
    !groupID ||
    !borrowingList ||
    !lenderList ||
    !amount
  ) {
    throw new BadRequestError(
      "Please provide all the necessary information for the Expense."
    );
  }
  const group = await Group.findOne({
    _id: groupID,
    members: { $in: [userID] },
  });
  if (group) {
    if (checkValidExpense(borrowingList, lenderList)) {
      // logic to divide expenses
      const expense = await Expense.create({
        name,
        amount,
        grp_id: groupID,
        borrowingList,
        lenderList,
        categoryName,
        addedByUser: userID,
      });
      if (expense) {
        let curLender = lenderList.pop()
        for (const borrower of borrowingList) {
          while (borrower.amount) {
            if (curLender.amount === 0) curLender = lenderList.pop();
            if (curLender.amount < entry.amount) {
              // Update with curLender.amount
              borrower.amount -= curLender.amount
              await addEdge(borrower.userID, curLender.userID, curLender.amount, groupID)
              curLender.amount = 0
            }
            else {
              // Update with borrower.amount
              curLender.amount -= borrower.amount
              await addEdge(borrower.userID, curLender.userID, borrower.amount, groupID)
              borrower.amount = 0
            }
          }
        }
        res.status(201).json({
          success: true,
          expense,
        });
      } else {
        res.status(500).json({
          success: false,
          msg: "Unable to add the expense, please try again later.",
        });
      }
    } else {
      res.status(500).json({
        success: false,
        msg: "The given expense is invalid, please try again.",
      });
    }
  } else {
    res.status(500).json({
      success: false,
      msg: "No group found with the given groupID or you are not authorized to add expenses to this group.",
    });
  }
};

async function addEdge(borrowerID, lenderID, amount, groupID) {
  const driver = await connectNeo4j();
  //query
  const statement =
    "MATCH (borrower:User {userID: $borrowerID, groupID: $groupID}) \
     MATCH (lender:User {userID: $lenderID, groupID: $groupID}) \
     MERGE (borrower)-[owes:OWES]->(lender) \
     SET owes.amount = $amount";
  const params = {
    borrowerID: borrowerID.toString(),
    lenderID: lenderID.toString(),
    groupID: groupID.toString(),
    amount: amount
  };
  await driver.executeQuery(statement, params, {
    database: "neo4j",
  });
  await driver.close();
}

function checkValidExpense(borrowingList, lenderList) {
  const sum1 = borrowingList.reduce((sum, { amount }) => sum + amount, 0);
  const sum2 = lenderList.reduce((sum, { amount }) => sum + amount, 0);
  return sum1 === sum2 && sum1 !== 0;
}

const deleteAllExpensesInGrp = async (req, res) => {
  const { groupID } = await req.params;
  const deletionResult = await Expense.deleteMany({ grp_id: groupID });
  if (deletionResult.acknowledged && deletionResult.deletedCount > 0) {
    res.status(200).json({
      success: true,
      msg: "All the expenses in this group deleted successfully!",
    });
  } else {
    res.status(500).json({
      success: false,
      msg: "Deletion failed or no documents were deleted.",
    });
  }
};

const deleteSingleExpense = async (req, res) => {
  const { expenseID } = await req.params;
  const deletedExpense = await Expense.findOneAndDelete({ _id: expenseID });
  if (deletedExpense) {
    res.status(200).json({
      success: true,
      msg: "Expense deleted successfully.",
    });
  } else {
    res.status(500).json({
      success: false,
      msg: "Deletion failed or no documents were deleted.",
    });
  }
};

const getSingleExpense = async (req, res) => {
  const { expenseID } = await req.params;
  const expense = await Expense.findOne({ _id: expenseID });
  if (expense) {
    res.status(200).json({ success: true, expense });
  } else {
    throw new NotFoundError("No expense found with the given expenseID.");
  }
};

const updateExpense = async (req, res) => {
  const { expenseID } = await req.params;
  const { name, amount, borrowingList, lenderList, categoryName } =
    await req.body;
  const updateBody = {};
  if (name) updateBody.name = name;
  if (amount) updateBody.amount = amount;
  if (borrowingList) updateBody.borrowingList = borrowingList;
  if (lenderList) updateBody.lenderList = lenderList;
  if (categoryName) updateBody.categoryName = categoryName;
  const updatedExpense = await Expense.findOneAndUpdate(
    { _id: expenseID },
    updateBody,
    {
      new: true,
      runValidators: true,
    }
  );
  if (updatedExpense) {
    res.status(200).json({ success: true, updatedExpense });
  } else {
    res.status(500).json({
      success: false,
      msg: "Unable to update the Expense, please try again later.",
    });
  }
};

const findUserTotalInGrp = async (req, res) => {
  const { userID } = await req.body.user;
  const { groupID } = await req.params;
  if (!userID || !groupID) {
    throw new BadRequestError("Please provide all the necessary information.");
  }

  const group = await Group.findOne({
    _id: groupID,
    members: { $in: [userID] },
  });
  if (group) {
    const aggregationResult = await Expense.aggregate([
      {
        $match: {
          grp_id: new mongoose.Types.ObjectId(groupID),
        },
      },
      {
        $project: {
          totalBorrowed: {
            $sum: {
              $map: {
                input: "$borrowingList",
                as: "borrower",
                in: {
                  $cond: [
                    {
                      $eq: [
                        "$$borrower.userID",
                        new mongoose.Types.ObjectId(userID),
                      ],
                    },
                    {
                      $multiply: [
                        "$amount",
                        { $divide: ["$$borrower.percentage", 100] },
                      ],
                    },
                    0,
                  ],
                },
              },
            },
          },
          totalLent: {
            $sum: {
              $map: {
                input: "$lenderList",
                as: "lender",
                in: {
                  $cond: [
                    {
                      $eq: [
                        "$$lender.userID",
                        new mongoose.Types.ObjectId(userID),
                      ],
                    },
                    {
                      $multiply: [
                        "$amount",
                        { $divide: ["$$lender.percentage", 100] },
                      ],
                    },
                    0,
                  ],
                },
              },
            },
          },
        },
      },
      {
        $project: {
          totalExpenditure: { $subtract: ["$totalLent", "$totalBorrowed"] },
        },
      },
    ]);
    if (aggregationResult) {
      res.status(200).json({
        success: true,
        balance: aggregationResult[0].totalExpenditure,
      });
    } else {
      res.status(500).json({
        success: false,
        msg: "Unable to get the total balance, please try again later.",
      });
    }
  } else {
    res.status(500).json({
      success: false,
      msg: "You are not a part of the given group.",
    });
  }
};

module.exports = {
  getAllExpenseInGroup,
  getAllExpenseInGroupWithoutFilters,
  addNewExpense,
  deleteAllExpensesInGrp,
  deleteSingleExpense,
  getSingleExpense,
  updateExpense,
  findUserTotalInGrp,
};
